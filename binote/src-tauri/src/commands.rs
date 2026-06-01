use crate::{
    asr::{AsrClient, AsrProvider, DashScopeClient, SenseVoiceClient},
    auth::{BiliAuth, BiliCredentials, QrcodeInfo, QrcodePollResult, RefreshResult},
    bilibili::{BilibiliClient, LoginStatus, PageInfo, VideoInfo},
    connection_test::ConnectionTestResult,
    error::Result,
    llm::LlmClient,
    notification::{send_notification, NotificationType},
    retry::RetryContext,
    store::{AppConfig, Note, Store},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

pub struct AppState {
    pub store: Mutex<Store>,
    pub tasks: Mutex<HashMap<String, TaskInfo>>,
    /// 任务句柄和取消令牌
    pub task_handles: Mutex<HashMap<String, (JoinHandle<()>, CancellationToken)>>,
    /// 全局取消令牌（应用退出时使用）
    pub global_cancel: CancellationToken,
    /// 转录任务并发闸：限制同时进行的转录任务数（容量来自 config，重启生效）
    pub transcribe_gate: Arc<Semaphore>,
    /// LLM 任务并发闸：限制同时进行的总结/思维导图独立任务数
    pub llm_gate: Arc<Semaphore>,
    /// 活跃任务计数（含排队中），用于维护 .task_running 标志的引用计数
    pub active_tasks: Arc<AtomicUsize>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct TaskInfo {
    pub status: String,
    pub progress: String,
    pub note_id: Option<String>,
    pub error: Option<String>,
}

/// 进度事件 payload：携带 task_id，使并发任务的进度能在前端按任务分流，互不串台。
#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    pub task_id: String,
    pub message: String,
}

/// 发送带 task_id 的进度事件。
fn emit_progress(app: &AppHandle, event: &str, task_id: &str, message: impl Into<String>) {
    let _ = app.emit(
        event,
        ProgressPayload {
            task_id: task_id.to_string(),
            message: message.into(),
        },
    );
}

/// 活跃任务计数 RAII guard。
///
/// 构造时计数 +1（0→1 时写 `.task_running` 标志文件，通知 Android 前台服务保活）；
/// Drop 时计数 -1（1→0 时删除标志文件）。用 guard 覆盖排队 / 运行 / 取消 / 失败 / 完成
/// 所有退出路径（包括 select! 取消分支的提前 return），避免手工成对调用导致漏减或双减，
/// 也修正了旧布尔标志在并发下"先完成的任务误删全局标志"的问题。
struct TaskFlagGuard {
    app: AppHandle,
    counter: Arc<AtomicUsize>,
}

impl TaskFlagGuard {
    fn new(app: AppHandle, counter: Arc<AtomicUsize>) -> Self {
        if counter.fetch_add(1, Ordering::SeqCst) == 0 {
            set_task_flag_file(&app, true);
        }
        Self { app, counter }
    }
}

impl Drop for TaskFlagGuard {
    fn drop(&mut self) {
        if self.counter.fetch_sub(1, Ordering::SeqCst) == 1 {
            set_task_flag_file(&self.app, false);
        }
    }
}

#[derive(Clone)]
struct SubtitleAccessDecision {
    use_subtitle: bool,
    sessdata: Option<String>,
    unavailable_reason: Option<String>,
}

/// 转录结果，区分总结是否成功
enum TranscribeResult {
    /// 转录 + 总结 + 思维导图都成功
    FullSuccess(Note),
    /// 仅转录成功（未配置 LLM 或生成失败）
    TranscribeOnly {
        note: Note,
        /// 总结失败的错误信息（None 表示未配置 LLM）
        summarize_error: Option<String>,
        /// 思维导图失败的错误信息
        mindmap_error: Option<String>,
    },
}

/// 对单个分P执行 ASR 转录
async fn transcribe_page_asr(
    bili: &BilibiliClient,
    asr: &AsrClient,
    aid: u64,
    cid: u64,
    app: &AppHandle,
    page_label: &str,
    task_id: &str,
) -> Result<String> {
    emit_progress(
        app,
        "transcribe:progress",
        task_id,
        format!("{}正在下载音频...", page_label),
    );
    let app_clone = app.clone();
    let task_id_clone = task_id.to_string();
    let page_label_clone = page_label.to_string();
    let audio_data = bili
        .download_audio_with_retry(
            aid,
            cid,
            Some(move |ctx: RetryContext| {
                let msg = match ctx.last_error {
                    Some(err) => format!(
                        "{}音频下载失败，正在重试 ({}/{}): {}",
                        page_label_clone, ctx.attempt, ctx.max_attempts, err
                    ),
                    None => format!(
                        "{}音频下载失败，正在重试 ({}/{})...",
                        page_label_clone, ctx.attempt, ctx.max_attempts
                    ),
                };
                emit_progress(&app_clone, "transcribe:progress", &task_id_clone, msg);
            }),
        )
        .await?;

    let provider_name = asr.provider_name();
    emit_progress(
        app,
        "transcribe:progress",
        task_id,
        format!("{}正在使用 {} 转录...", page_label, provider_name),
    );
    let app_clone = app.clone();
    let task_id_clone = task_id.to_string();
    let page_label_clone = page_label.to_string();
    let provider_name_clone = provider_name.to_string();
    let transcript = asr
        .transcribe_with_retry(
            &audio_data,
            Some(move |ctx: RetryContext| {
                let msg = match ctx.last_error {
                    Some(err) => format!(
                        "{}{} 转录失败，正在重试 ({}/{}): {}",
                        page_label_clone, provider_name_clone, ctx.attempt, ctx.max_attempts, err
                    ),
                    None => format!(
                        "{}{} 转录失败，正在重试 ({}/{})...",
                        page_label_clone, provider_name_clone, ctx.attempt, ctx.max_attempts
                    ),
                };
                emit_progress(&app_clone, "transcribe:progress", &task_id_clone, msg);
            }),
        )
        .await
        .map_err(|e| crate::error::AppError::AsrError(e.to_string()))?;

    Ok(transcript)
}

fn format_asr_reason(page: &PageInfo, is_multi_page: bool, reason: &str) -> String {
    if is_multi_page {
        format!("P{}（{}）：{}", page.page, page.part, reason)
    } else {
        reason.to_string()
    }
}

fn build_transcript_reason(
    transcript_source: Option<&str>,
    asr_reasons: &[String],
) -> Option<String> {
    if asr_reasons.is_empty() {
        return None;
    }

    let details = if asr_reasons.len() == 1 {
        asr_reasons[0].clone()
    } else {
        asr_reasons
            .iter()
            .map(|reason| format!("• {}", reason))
            .collect::<Vec<_>>()
            .join("\n")
    };

    match transcript_source {
        Some("asr") => Some(format!("本次未走原生字幕，原因：\n{}", details)),
        Some("mixed") => Some(format!(
            "以下内容未命中原生字幕，已回退到 ASR：\n{}",
            details
        )),
        _ => None,
    }
}

/// 核心转录逻辑（共用函数）
///
/// 执行完整的转录流程：
/// 获取视频信息 → 获取分P列表 → [验证SESSDATA → 尝试字幕] / ASR转录 → 合并 → 保存笔记
async fn perform_transcription(
    bvid: &str,
    source_url: Option<&str>,
    config: &AppConfig,
    store: &Mutex<Store>,
    app: &AppHandle,
    task_id: &str,
) -> Result<Note> {
    // 根据选择的 ASR 提供商获取对应的 API Key（字幕失败时 fallback 需要）
    let asr_key = match config.asr_provider {
        AsrProvider::DashScope => {
            config
                .asr_api_key
                .clone()
                .ok_or(crate::error::AppError::AsrError(
                    "未配置 DashScope API Key".into(),
                ))?
        }
        AsrProvider::SenseVoice => {
            config
                .sensevoice_api_key
                .clone()
                .ok_or(crate::error::AppError::AsrError(
                    "未配置 SenseVoice API Key".into(),
                ))?
        }
    };

    let bili = BilibiliClient::new();

    // === 获取视频信息（带重试）===
    emit_progress(app, "transcribe:progress", task_id, "正在获取视频信息...");
    let app_clone = app.clone();
    let task_id_clone = task_id.to_string();
    let info = bili
        .get_video_info_with_retry(
            bvid,
            Some(move |ctx: RetryContext| {
                let msg = match ctx.last_error {
                    Some(err) => format!(
                        "获取视频信息失败，正在重试 ({}/{}): {}",
                        ctx.attempt, ctx.max_attempts, err
                    ),
                    None => format!(
                        "获取视频信息失败，正在重试 ({}/{})...",
                        ctx.attempt, ctx.max_attempts
                    ),
                };
                emit_progress(&app_clone, "transcribe:progress", &task_id_clone, msg);
            }),
        )
        .await?;

    // === 获取分P列表 ===
    emit_progress(app, "transcribe:progress", task_id, "正在获取分P列表...");
    let pages = bili.get_page_list(bvid).await?;
    let is_multi_page = pages.len() > 1;
    let total_pages = pages.len();

    // === 判断是否可以尝试字幕（集成自动刷新）===
    let subtitle_access = try_auto_refresh_sessdata(config, store, app, task_id).await;
    let sessdata = subtitle_access.sessdata.as_deref();

    // === 逐P处理 ===
    let asr = AsrClient::new(config.asr_provider.clone(), asr_key);
    let mut page_texts: Vec<String> = Vec::with_capacity(total_pages);
    let mut subtitle_count = 0u32;
    let mut asr_count = 0u32;
    let mut asr_reasons: Vec<String> = Vec::new();

    for (idx, page) in pages.iter().enumerate() {
        let page_num = idx + 1;
        let page_label = if is_multi_page {
            format!("P{}/{} ({}) ", page_num, total_pages, page.part)
        } else {
            String::new()
        };

        emit_progress(
            app,
            "transcribe:progress",
            task_id,
            format!(
                "{}正在处理...",
                if is_multi_page {
                    format!("正在处理 P{}/{}: {}...", page_num, total_pages, page.part)
                } else {
                    "正在处理...".to_string()
                }
            ),
        );

        // 尝试获取字幕
        let mut got_subtitle = false;
        let mut asr_reason = if !subtitle_access.use_subtitle {
            subtitle_access
                .unavailable_reason
                .as_ref()
                .map(|reason| format_asr_reason(page, is_multi_page, reason))
        } else {
            None
        };

        if subtitle_access.use_subtitle {
            if let Some(sd) = sessdata {
                emit_progress(
                    app,
                    "transcribe:progress",
                    task_id,
                    format!("{}正在获取字幕...", page_label),
                );
                match bili.get_subtitle_text(bvid, info.aid, page.cid, sd).await {
                    Ok(text) => {
                        // 字幕质量检查：文本长度是否与视频时长匹配
                        if BilibiliClient::is_subtitle_sufficient(&text, page.duration) {
                            page_texts.push(text);
                            subtitle_count += 1;
                            got_subtitle = true;
                            emit_progress(
                                app,
                                "transcribe:progress",
                                task_id,
                                format!("{}字幕获取成功", page_label),
                            );
                        } else {
                            let char_count = text.chars().count();
                            emit_progress(
                                app,
                                "transcribe:progress",
                                task_id,
                                format!(
                                    "{}字幕内容过短（{}字/{}秒），切换到 ASR...",
                                    page_label, char_count, page.duration
                                ),
                            );
                            asr_reason = Some(format_asr_reason(
                                page,
                                is_multi_page,
                                &format!(
                                    "B站返回的字幕内容过短（{}字/{}秒），未达到质量阈值",
                                    char_count, page.duration
                                ),
                            ));
                        }
                    }
                    Err(e) => {
                        emit_progress(
                            app,
                            "transcribe:progress",
                            task_id,
                            format!("{}字幕获取失败（{}），切换到 ASR...", page_label, e),
                        );
                        let err_msg = e.to_string();
                        let cleaned = err_msg
                            .strip_prefix("字幕获取失败: ")
                            .unwrap_or(err_msg.as_str());
                        asr_reason = Some(format_asr_reason(
                            page,
                            is_multi_page,
                            &format!("B站字幕获取失败：{}", cleaned),
                        ));
                    }
                }
            } else {
                asr_reason = Some(format_asr_reason(
                    page,
                    is_multi_page,
                    "未拿到有效的登录凭证，无法发起字幕请求",
                ));
            }
        }

        // Fallback: ASR 转录
        if !got_subtitle {
            if let Some(reason) = asr_reason {
                asr_reasons.push(reason);
            }
            let transcript =
                transcribe_page_asr(&bili, &asr, info.aid, page.cid, app, &page_label, task_id)
                    .await?;
            page_texts.push(transcript);
            asr_count += 1;
        }
    }

    // === 合并文本 ===
    let transcript = if is_multi_page {
        // 多P: 添加分段标记
        pages
            .iter()
            .enumerate()
            .map(|(idx, page)| format!("【P{}: {}】\n{}", page.page, page.part, page_texts[idx]))
            .collect::<Vec<_>>()
            .join("\n\n")
    } else {
        // 单P: 纯文本
        page_texts.into_iter().next().unwrap_or_default()
    };

    // === 确定 transcript_source ===
    let transcript_source = if asr_count == 0 {
        Some("subtitle".to_string())
    } else if subtitle_count == 0 {
        Some("asr".to_string())
    } else {
        Some("mixed".to_string())
    };
    let transcript_reason = build_transcript_reason(transcript_source.as_deref(), &asr_reasons);

    emit_progress(app, "transcribe:progress", task_id, "转写完成，正在保存...");

    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        bvid: info.bvid,
        source_url: source_url
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .map(ToOwned::to_owned),
        title: info.title,
        cover: info.cover,
        transcript,
        summary: None,
        mindmap: None,
        created_at: chrono::Utc::now().timestamp(),
        transcript_source,
        transcript_reason,
    };

    store.lock().unwrap().save_note(note.clone())?;

    Ok(note)
}

/// 获取任务标志文件路径
fn get_task_flag_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().data_dir().ok().map(|p| p.join(".task_running"))
}

/// 写入 / 删除任务运行标志文件（仅由 `TaskFlagGuard` 与应用退出清理调用）。
fn set_task_flag_file(app: &AppHandle, running: bool) {
    if let Some(flag_path) = get_task_flag_path(app) {
        if running {
            // 创建标志文件
            let _ = std::fs::write(&flag_path, "1");
        } else {
            // 删除标志文件
            let _ = std::fs::remove_file(&flag_path);
        }
    }
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig> {
    state.store.lock().unwrap().load_config()
}

#[tauri::command]
pub async fn save_config(state: State<'_, AppState>, config: AppConfig) -> Result<()> {
    state.store.lock().unwrap().save_config(&config)
}

#[tauri::command]
pub async fn get_notes(state: State<'_, AppState>) -> Result<Vec<Note>> {
    state.store.lock().unwrap().load_notes()
}

#[tauri::command]
pub async fn get_note(state: State<'_, AppState>, id: String) -> Result<Option<Note>> {
    let notes = state.store.lock().unwrap().load_notes()?;
    Ok(notes.into_iter().find(|n| n.id == id))
}

#[tauri::command]
pub async fn delete_note(state: State<'_, AppState>, id: String) -> Result<()> {
    state.store.lock().unwrap().delete_note(&id)
}

#[tauri::command]
pub async fn parse_link(input: String) -> Result<String> {
    let client = BilibiliClient::new();
    client.extract_bvid(&input).await
}

#[tauri::command]
pub async fn get_video_info(bvid: String) -> Result<VideoInfo> {
    let client = BilibiliClient::new();
    client.get_video_info(&bvid).await
}

#[tauri::command]
pub async fn transcribe(
    state: State<'_, AppState>,
    bvid: String,
    source_url: Option<String>,
    app: AppHandle,
) -> Result<Note> {
    let config = state.store.lock().unwrap().load_config()?;
    let task_id = uuid::Uuid::new_v4().to_string();
    perform_transcription(
        &bvid,
        source_url.as_deref(),
        &config,
        &state.store,
        &app,
        &task_id,
    )
    .await
}

#[tauri::command]
pub async fn summarize(
    state: State<'_, AppState>,
    note_id: String,
    app: AppHandle,
) -> Result<Note> {
    let config = state.store.lock().unwrap().load_config()?;

    let llm_key = config.llm_api_key.ok_or(crate::error::AppError::LlmError(
        "未配置 LLM API Key".into(),
    ))?;
    let base_url = config
        .llm_base_url
        .unwrap_or("https://api.openai.com/v1".into());
    let model = config.llm_model.unwrap_or("gpt-4o-mini".into());

    let note = state
        .store
        .lock()
        .unwrap()
        .load_notes()?
        .into_iter()
        .find(|n| n.id == note_id)
        .ok_or(crate::error::AppError::StoreError("笔记不存在".into()))?;

    let _ = app.emit("summarize:progress", "生成总结...");

    let llm = LlmClient::new(llm_key, base_url, model);
    let app_clone = app.clone();
    let summary = llm
        .summarize_with_retry(
            &note.transcript,
            &note.title,
            Some(move |ctx: RetryContext| {
                let msg = match ctx.last_error {
                    Some(err) => format!(
                        "AI 总结失败，正在重试 ({}/{}): {}",
                        ctx.attempt, ctx.max_attempts, err
                    ),
                    None => format!(
                        "AI 总结失败，正在重试 ({}/{})...",
                        ctx.attempt, ctx.max_attempts
                    ),
                };
                let _ = app_clone.emit("summarize:progress", msg);
            }),
        )
        .await?;

    let note = state
        .store
        .lock()
        .unwrap()
        .update_note(&note_id, |n| n.summary = Some(summary))?;

    Ok(note)
}

#[tauri::command]
pub async fn start_transcribe(
    state: State<'_, AppState>,
    bvid: String,
    source_url: Option<String>,
    app: AppHandle,
) -> Result<String> {
    let task_id = uuid::Uuid::new_v4().to_string();

    // 创建任务专属的取消令牌，链接到全局取消令牌
    let cancel_token = state.global_cancel.child_token();

    // 初始为"排队中"：拿到并发许可后才转为 running（见 spawn 内逻辑）
    state.tasks.lock().unwrap().insert(
        task_id.clone(),
        TaskInfo {
            status: "queued".into(),
            progress: "排队中…".into(),
            note_id: None,
            error: None,
        },
    );

    let task_id_clone = task_id.clone();
    let app_clone = app.clone();
    let cancel_token_clone = cancel_token.clone();
    let gate = state.transcribe_gate.clone();
    let active_tasks = state.active_tasks.clone();
    let handle = tokio::spawn(async move {
        // 活跃任务计数 guard：从排队到结束全程持有，任何退出路径都会自动递减
        let _flag = TaskFlagGuard::new(app_clone.clone(), active_tasks);

        // 阶段一：获取并发许可（排队期间可被取消，取消时不会泄漏许可）
        let _permit = tokio::select! {
            _ = cancel_token_clone.cancelled() => {
                let state = app_clone.state::<AppState>();
                state.tasks.lock().unwrap().insert(task_id_clone.clone(), TaskInfo {
                    status: "cancelled".into(),
                    progress: "已取消".into(),
                    note_id: None,
                    error: Some("任务已被取消".into()),
                });
                state.task_handles.lock().unwrap().remove(&task_id_clone);
                return;
            }
            permit = gate.acquire_owned() => match permit {
                Ok(p) => p,
                Err(_) => return, // 信号量被关闭（正常情况下不会发生）
            }
        };

        // 拿到许可，转为运行态
        {
            let state = app_clone.state::<AppState>();
            let mut tasks = state.tasks.lock().unwrap();
            if let Some(info) = tasks.get_mut(&task_id_clone) {
                info.status = "running".into();
                info.progress = "正在准备...".into();
            }
        }

        // 阶段二：执行转录（同样监听取消信号）
        let result = tokio::select! {
            _ = cancel_token_clone.cancelled() => {
                let state = app_clone.state::<AppState>();
                state.tasks.lock().unwrap().insert(task_id_clone.clone(), TaskInfo {
                    status: "cancelled".into(),
                    progress: "已取消".into(),
                    note_id: None,
                    error: Some("任务已被取消".into()),
                });
                // 清理任务句柄，防止内存泄漏
                state.task_handles.lock().unwrap().remove(&task_id_clone);
                return;
            }
            result = transcribe_background(bvid, source_url, task_id_clone.clone(), app_clone.clone(), cancel_token_clone.clone(), _permit) => result
        };

        let state = app_clone.state::<AppState>();
        let mut tasks = state.tasks.lock().unwrap();
        match result {
            Ok(TranscribeResult::FullSuccess(note)) => {
                tasks.insert(
                    task_id_clone.clone(),
                    TaskInfo {
                        status: "completed".into(),
                        progress: "完成".into(),
                        note_id: Some(note.id.clone()),
                        error: None,
                    },
                );
                send_notification(
                    &app_clone,
                    NotificationType::TranscribeAndSummarizeSuccess {
                        title: note.title.clone(),
                        note_id: note.id.clone(),
                    },
                );
            }
            Ok(TranscribeResult::TranscribeOnly {
                note,
                summarize_error,
                mindmap_error,
            }) => {
                // 根据错误情况选择通知类型
                let has_summary_error = summarize_error.is_some();
                let has_mindmap_error = mindmap_error.is_some();

                let notification_type = if has_summary_error || has_mindmap_error {
                    NotificationType::TranscribeSuccessSummarizeFailed {
                        title: note.title.clone(),
                        note_id: note.id.clone(),
                    }
                } else {
                    NotificationType::TranscribeSuccess {
                        title: note.title.clone(),
                        note_id: note.id.clone(),
                    }
                };

                // 合并错误信息（使用换行分隔，更易读）
                let error_msg = match (summarize_error, mindmap_error) {
                    (Some(s), Some(m)) => Some(format!("{}\n{}", s, m)),
                    (Some(s), None) => Some(s),
                    (None, Some(m)) => Some(m),
                    (None, None) => None,
                };

                tasks.insert(
                    task_id_clone.clone(),
                    TaskInfo {
                        status: "completed".into(),
                        progress: "完成".into(),
                        note_id: Some(note.id.clone()),
                        error: error_msg,
                    },
                );
                send_notification(&app_clone, notification_type);
            }
            Err(e) => {
                tasks.insert(
                    task_id_clone.clone(),
                    TaskInfo {
                        status: "failed".into(),
                        progress: "失败".into(),
                        note_id: None,
                        error: Some(e.to_string()),
                    },
                );

                // 发送转录失败通知
                send_notification(&app_clone, NotificationType::TranscribeFailed);
            }
        }
        // 释放 tasks 锁后再清理 task_handles，防止内存泄漏
        drop(tasks);
        state.task_handles.lock().unwrap().remove(&task_id_clone);
    });

    // 保存任务句柄和取消令牌
    state
        .task_handles
        .lock()
        .unwrap()
        .insert(task_id.clone(), (handle, cancel_token));

    Ok(task_id)
}

#[tauri::command]
pub async fn get_task_status(state: State<'_, AppState>, task_id: String) -> Result<TaskInfo> {
    state
        .tasks
        .lock()
        .unwrap()
        .get(&task_id)
        .cloned()
        .ok_or(crate::error::AppError::StoreError("任务不存在".into()))
}

async fn transcribe_background(
    bvid: String,
    source_url: Option<String>,
    task_id: String,
    app: AppHandle,
    cancel_token: CancellationToken,
    permit: tokio::sync::OwnedSemaphorePermit,
) -> Result<TranscribeResult> {
    let state = app.state::<AppState>();
    let config = state.store.lock().unwrap().load_config()?;

    // 检查取消状态
    if cancel_token.is_cancelled() {
        return Err(crate::error::AppError::StoreError("任务已取消".into()));
    }

    // 调用共用转录逻辑
    let note = perform_transcription(
        &bvid,
        source_url.as_deref(),
        &config,
        &state.store,
        &app,
        &task_id,
    )
    .await?;

    // 检查取消状态
    if cancel_token.is_cancelled() {
        return Err(crate::error::AppError::StoreError("任务已取消".into()));
    }

    // 纯转录已完成：立即释放 transcribe_gate 许可。后续自动 LLM 阶段（总结/思维导图）
    // 不应再占用转录并发名额，否则队列中下一个待转录任务会被 LLM 生成时间白白阻塞。
    drop(permit);

    // ===== 自动生成逻辑（按用户开关跳过总结 / 思维导图）=====
    let auto_summary = config.auto_summary;
    let auto_mindmap = config.auto_mindmap;

    // 两个都关：跳过整个 LLM 阶段（包括 API Key 校验）
    if !auto_summary && !auto_mindmap {
        return Ok(TranscribeResult::TranscribeOnly {
            note,
            summarize_error: None,
            mindmap_error: None,
        });
    }

    // 检查 LLM 配置是否有效
    let llm_key = match &config.llm_api_key {
        Some(key) if !key.is_empty() => key.clone(),
        _ => {
            return Ok(TranscribeResult::TranscribeOnly {
                note,
                summarize_error: None,
                mindmap_error: None,
            })
        }
    };

    let base_url = config
        .llm_base_url
        .clone()
        .unwrap_or("https://api.openai.com/v1".into());
    let model = config.llm_model.clone().unwrap_or("gpt-4o-mini".into());

    // 进度文案按开关组合：两个都开 → "总结和思维导图"；单选 → 对应项
    let progress_label = match (auto_summary, auto_mindmap) {
        (true, true) => "正在生成 AI 总结和思维导图...",
        (true, false) => "正在生成 AI 总结...",
        (false, true) => "正在生成思维导图...",
        (false, false) => unreachable!("已在上方提前返回"),
    };
    emit_progress(&app, "transcribe:progress", &task_id, progress_label);

    // 创建 LLM 客户端（内部 reqwest::Client 是 Arc，clone 廉价）
    let llm = LlmClient::new(llm_key, base_url, model);

    // 准备并行 future：未启用的项直接返回 None，避免无谓的 LLM 调用。
    // 流式版本通过 update_stream_progress 同时写 task.progress + emit
    // "transcribe:progress" 事件，让 Dashboard 在 LLM 阶段也能看到实时字数。
    let summary_fut = {
        let llm = llm.clone();
        let app_retry = app.clone();
        let task_id_retry = task_id.clone();
        let app_progress = app.clone();
        let task_id_progress = task_id.clone();
        let transcript = note.transcript.clone();
        let title = note.title.clone();
        async move {
            if !auto_summary {
                return None;
            }
            Some(
                llm.summarize_stream_with_retry(
                    &transcript,
                    &title,
                    Some(move |ctx: RetryContext| {
                        let msg = match ctx.last_error {
                            Some(err) => format!(
                                "AI 总结失败，正在重试 ({}/{}): {}",
                                ctx.attempt, ctx.max_attempts, err
                            ),
                            None => format!(
                                "AI 总结失败，正在重试 ({}/{})...",
                                ctx.attempt, ctx.max_attempts
                            ),
                        };
                        emit_progress(&app_retry, "transcribe:progress", &task_id_retry, msg);
                    }),
                    move |chars: usize| {
                        update_stream_progress(
                            &app_progress,
                            &task_id_progress,
                            "transcribe:progress",
                            "AI 总结产出中",
                            chars,
                        );
                    },
                )
                .await,
            )
        }
    };

    let mindmap_fut = {
        let app_retry = app.clone();
        let task_id_retry = task_id.clone();
        let app_progress = app.clone();
        let task_id_progress = task_id.clone();
        let transcript = note.transcript.clone();
        let title = note.title.clone();
        async move {
            if !auto_mindmap {
                return None;
            }
            Some(
                llm.generate_mindmap_stream_with_retry(
                    &transcript,
                    &title,
                    Some(move |ctx: RetryContext| {
                        let msg = match ctx.last_error {
                            Some(err) => format!(
                                "思维导图生成失败，正在重试 ({}/{}): {}",
                                ctx.attempt, ctx.max_attempts, err
                            ),
                            None => format!(
                                "思维导图生成失败，正在重试 ({}/{})...",
                                ctx.attempt, ctx.max_attempts
                            ),
                        };
                        emit_progress(&app_retry, "transcribe:progress", &task_id_retry, msg);
                    }),
                    move |chars: usize| {
                        update_stream_progress(
                            &app_progress,
                            &task_id_progress,
                            "transcribe:progress",
                            "思维导图产出中",
                            chars,
                        );
                    },
                )
                .await,
            )
        }
    };

    let (summary_opt, mindmap_opt) = tokio::join!(summary_fut, mindmap_fut);

    // None = 用户未启用，不算失败；Some(Err) 才记录错误
    let (summary, summarize_error) = match summary_opt {
        None => (None, None),
        Some(Ok(s)) => (Some(s), None),
        Some(Err(e)) => (None, Some(format!("AI 总结失败: {}", e))),
    };
    let (mindmap, mindmap_error) = match mindmap_opt {
        None => (None, None),
        Some(Ok(m)) => (Some(m), None),
        Some(Err(e)) => (None, Some(format!("思维导图失败: {}", e))),
    };

    // 字段级合并写回（只覆盖 summary / mindmap 两个字段，不整条覆盖）
    let note_id = note.id.clone();
    let updated_note = state.store.lock().unwrap().update_note(&note_id, |n| {
        n.summary = summary;
        n.mindmap = mindmap;
    })?;

    // 判断是否全部成功
    if summarize_error.is_none() && mindmap_error.is_none() {
        Ok(TranscribeResult::FullSuccess(updated_note))
    } else {
        Ok(TranscribeResult::TranscribeOnly {
            note: updated_note,
            summarize_error,
            mindmap_error,
        })
    }
}

/// 流式生成期间更新任务进度：同时写入 task registry 的 progress 字段并 emit 事件，
/// 两条通道文案一致，避免 poll 与事件互相覆盖造成闪烁。
fn update_stream_progress(app: &AppHandle, task_id: &str, event: &str, label: &str, chars: usize) {
    let msg = format!("{} · 已生成 {} 字", label, chars);
    let state = app.state::<AppState>();
    if let Ok(mut tasks) = state.tasks.lock() {
        if let Some(info) = tasks.get_mut(task_id) {
            info.progress = msg.clone();
        }
    }
    emit_progress(app, event, task_id, msg);
}

#[tauri::command]
pub async fn start_summarize(
    state: State<'_, AppState>,
    note_id: String,
    app: AppHandle,
) -> Result<String> {
    let task_id = uuid::Uuid::new_v4().to_string();

    // 创建任务专属的取消令牌
    let cancel_token = state.global_cancel.child_token();

    state.tasks.lock().unwrap().insert(
        task_id.clone(),
        TaskInfo {
            status: "queued".into(),
            progress: "排队中…".into(),
            note_id: Some(note_id.clone()),
            error: None,
        },
    );

    let task_id_clone = task_id.clone();
    let app_clone = app.clone();
    let cancel_token_clone = cancel_token.clone();
    let gate = state.llm_gate.clone();
    let active_tasks = state.active_tasks.clone();
    let handle = tokio::spawn(async move {
        let _flag = TaskFlagGuard::new(app_clone.clone(), active_tasks);

        // 阶段一：获取 LLM 并发许可（排队期间可被取消）
        let _permit = tokio::select! {
            _ = cancel_token_clone.cancelled() => {
                let state = app_clone.state::<AppState>();
                state.tasks.lock().unwrap().insert(task_id_clone.clone(), TaskInfo {
                    status: "cancelled".into(),
                    progress: "已取消".into(),
                    note_id: None,
                    error: Some("任务已被取消".into()),
                });
                state.task_handles.lock().unwrap().remove(&task_id_clone);
                return;
            }
            permit = gate.acquire_owned() => match permit {
                Ok(p) => p,
                Err(_) => return,
            }
        };

        {
            let state = app_clone.state::<AppState>();
            let mut tasks = state.tasks.lock().unwrap();
            if let Some(info) = tasks.get_mut(&task_id_clone) {
                info.status = "running".into();
                info.progress = "正在生成总结...".into();
            }
        }

        // 阶段二：执行总结（监听取消信号）
        let result = tokio::select! {
            _ = cancel_token_clone.cancelled() => {
                let state = app_clone.state::<AppState>();
                state.tasks.lock().unwrap().insert(task_id_clone.clone(), TaskInfo {
                    status: "cancelled".into(),
                    progress: "已取消".into(),
                    note_id: None,
                    error: Some("任务已被取消".into()),
                });
                // 清理任务句柄，防止内存泄漏
                state.task_handles.lock().unwrap().remove(&task_id_clone);
                return;
            }
            result = summarize_background(note_id, task_id_clone.clone(), app_clone.clone()) => result
        };

        let state = app_clone.state::<AppState>();
        let mut tasks = state.tasks.lock().unwrap();
        match result {
            Ok(note) => {
                tasks.insert(
                    task_id_clone.clone(),
                    TaskInfo {
                        status: "completed".into(),
                        progress: "完成".into(),
                        note_id: Some(note.id.clone()),
                        error: None,
                    },
                );

                // 发送总结成功通知
                send_notification(
                    &app_clone,
                    NotificationType::SummarizeSuccess {
                        title: note.title.clone(),
                        note_id: note.id.clone(),
                    },
                );
            }
            Err(e) => {
                tasks.insert(
                    task_id_clone.clone(),
                    TaskInfo {
                        status: "failed".into(),
                        progress: "失败".into(),
                        note_id: None,
                        error: Some(e.to_string()),
                    },
                );

                // 发送总结失败通知
                send_notification(&app_clone, NotificationType::SummarizeFailed);
            }
        }
        // 释放 tasks 锁后再清理 task_handles，防止内存泄漏
        drop(tasks);
        state.task_handles.lock().unwrap().remove(&task_id_clone);
    });

    // 保存任务句柄和取消令牌
    state
        .task_handles
        .lock()
        .unwrap()
        .insert(task_id.clone(), (handle, cancel_token));

    Ok(task_id)
}

async fn summarize_background(note_id: String, task_id: String, app: AppHandle) -> Result<Note> {
    let state = app.state::<AppState>();
    let config = state.store.lock().unwrap().load_config()?;

    let llm_key = config.llm_api_key.ok_or(crate::error::AppError::LlmError(
        "未配置 LLM API Key".into(),
    ))?;
    let base_url = config
        .llm_base_url
        .unwrap_or("https://api.openai.com/v1".into());
    let model = config.llm_model.unwrap_or("gpt-4o-mini".into());

    let note = state
        .store
        .lock()
        .unwrap()
        .load_notes()?
        .into_iter()
        .find(|n| n.id == note_id)
        .ok_or(crate::error::AppError::StoreError("笔记不存在".into()))?;

    emit_progress(&app, "summarize:progress", &task_id, "生成总结...");

    let llm = LlmClient::new(llm_key, base_url, model);
    let app_retry = app.clone();
    let task_id_retry = task_id.clone();
    let app_progress = app.clone();
    let task_id_progress = task_id.clone();
    let summary = llm
        .summarize_stream_with_retry(
            &note.transcript,
            &note.title,
            Some(move |ctx: RetryContext| {
                let msg = match ctx.last_error {
                    Some(err) => format!(
                        "AI 总结失败，正在重试 ({}/{}): {}",
                        ctx.attempt, ctx.max_attempts, err
                    ),
                    None => format!(
                        "AI 总结失败，正在重试 ({}/{})...",
                        ctx.attempt, ctx.max_attempts
                    ),
                };
                emit_progress(&app_retry, "summarize:progress", &task_id_retry, msg);
            }),
            move |chars: usize| {
                update_stream_progress(
                    &app_progress,
                    &task_id_progress,
                    "summarize:progress",
                    "总结产出中",
                    chars,
                );
            },
        )
        .await?;

    let note = state
        .store
        .lock()
        .unwrap()
        .update_note(&note_id, |n| n.summary = Some(summary))?;

    Ok(note)
}

#[tauri::command]
pub async fn start_mindmap(
    state: State<'_, AppState>,
    note_id: String,
    app: AppHandle,
) -> Result<String> {
    let task_id = uuid::Uuid::new_v4().to_string();

    // 创建任务专属的取消令牌
    let cancel_token = state.global_cancel.child_token();

    state.tasks.lock().unwrap().insert(
        task_id.clone(),
        TaskInfo {
            status: "queued".into(),
            progress: "排队中…".into(),
            note_id: Some(note_id.clone()),
            error: None,
        },
    );

    let task_id_clone = task_id.clone();
    let app_clone = app.clone();
    let cancel_token_clone = cancel_token.clone();
    let gate = state.llm_gate.clone();
    let active_tasks = state.active_tasks.clone();
    let handle = tokio::spawn(async move {
        let _flag = TaskFlagGuard::new(app_clone.clone(), active_tasks);

        // 阶段一：获取 LLM 并发许可（排队期间可被取消）
        let _permit = tokio::select! {
            _ = cancel_token_clone.cancelled() => {
                let state = app_clone.state::<AppState>();
                state.tasks.lock().unwrap().insert(task_id_clone.clone(), TaskInfo {
                    status: "cancelled".into(),
                    progress: "已取消".into(),
                    note_id: None,
                    error: Some("任务已被取消".into()),
                });
                state.task_handles.lock().unwrap().remove(&task_id_clone);
                return;
            }
            permit = gate.acquire_owned() => match permit {
                Ok(p) => p,
                Err(_) => return,
            }
        };

        {
            let state = app_clone.state::<AppState>();
            let mut tasks = state.tasks.lock().unwrap();
            if let Some(info) = tasks.get_mut(&task_id_clone) {
                info.status = "running".into();
                info.progress = "正在生成思维导图...".into();
            }
        }

        // 阶段二：执行思维导图生成（监听取消信号）
        let result = tokio::select! {
            _ = cancel_token_clone.cancelled() => {
                let state = app_clone.state::<AppState>();
                state.tasks.lock().unwrap().insert(task_id_clone.clone(), TaskInfo {
                    status: "cancelled".into(),
                    progress: "已取消".into(),
                    note_id: None,
                    error: Some("任务已被取消".into()),
                });
                // 清理任务句柄，防止内存泄漏
                state.task_handles.lock().unwrap().remove(&task_id_clone);
                return;
            }
            result = mindmap_background(note_id, task_id_clone.clone(), app_clone.clone()) => result
        };

        let state = app_clone.state::<AppState>();
        let mut tasks = state.tasks.lock().unwrap();
        match result {
            Ok(note) => {
                tasks.insert(
                    task_id_clone.clone(),
                    TaskInfo {
                        status: "completed".into(),
                        progress: "完成".into(),
                        note_id: Some(note.id.clone()),
                        error: None,
                    },
                );

                // 发送思维导图成功通知
                send_notification(
                    &app_clone,
                    NotificationType::MindmapSuccess {
                        title: note.title.clone(),
                        note_id: note.id.clone(),
                    },
                );
            }
            Err(e) => {
                tasks.insert(
                    task_id_clone.clone(),
                    TaskInfo {
                        status: "failed".into(),
                        progress: "失败".into(),
                        note_id: None,
                        error: Some(e.to_string()),
                    },
                );

                // 发送思维导图失败通知
                send_notification(&app_clone, NotificationType::MindmapFailed);
            }
        }
        // 释放 tasks 锁后再清理 task_handles，防止内存泄漏
        drop(tasks);
        state.task_handles.lock().unwrap().remove(&task_id_clone);
    });

    // 保存任务句柄和取消令牌
    state
        .task_handles
        .lock()
        .unwrap()
        .insert(task_id.clone(), (handle, cancel_token));

    Ok(task_id)
}

async fn mindmap_background(note_id: String, task_id: String, app: AppHandle) -> Result<Note> {
    let state = app.state::<AppState>();
    let config = state.store.lock().unwrap().load_config()?;

    let llm_key = config.llm_api_key.ok_or(crate::error::AppError::LlmError(
        "未配置 LLM API Key".into(),
    ))?;
    let base_url = config
        .llm_base_url
        .unwrap_or("https://api.openai.com/v1".into());
    let model = config.llm_model.unwrap_or("gpt-4o-mini".into());

    let note = state
        .store
        .lock()
        .unwrap()
        .load_notes()?
        .into_iter()
        .find(|n| n.id == note_id)
        .ok_or(crate::error::AppError::StoreError("笔记不存在".into()))?;

    emit_progress(&app, "mindmap:progress", &task_id, "生成思维导图...");

    let llm = LlmClient::new(llm_key, base_url, model);
    let app_retry = app.clone();
    let task_id_retry = task_id.clone();
    let app_progress = app.clone();
    let task_id_progress = task_id.clone();
    let mindmap = llm
        .generate_mindmap_stream_with_retry(
            &note.transcript,
            &note.title,
            Some(move |ctx: RetryContext| {
                let msg = match ctx.last_error {
                    Some(err) => format!(
                        "思维导图生成失败，正在重试 ({}/{}): {}",
                        ctx.attempt, ctx.max_attempts, err
                    ),
                    None => format!(
                        "思维导图生成失败，正在重试 ({}/{})...",
                        ctx.attempt, ctx.max_attempts
                    ),
                };
                emit_progress(&app_retry, "mindmap:progress", &task_id_retry, msg);
            }),
            move |chars: usize| {
                update_stream_progress(
                    &app_progress,
                    &task_id_progress,
                    "mindmap:progress",
                    "思维导图产出中",
                    chars,
                );
            },
        )
        .await?;

    let note = state
        .store
        .lock()
        .unwrap()
        .update_note(&note_id, |n| n.mindmap = Some(mindmap))?;

    Ok(note)
}

/// 验证 B站 SESSDATA 有效性
#[tauri::command]
pub async fn verify_sessdata(sessdata: String) -> Result<LoginStatus> {
    let bili = BilibiliClient::new();
    bili.check_login_status(&sessdata).await
}

/// 测试 LLM API 连通性
///
/// 不依赖已保存的配置，直接使用传入的参数发起最小开销请求。
/// 空字段会使用与正式调用一致的默认值。
#[tauri::command]
pub async fn test_llm_connection(
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<ConnectionTestResult> {
    if api_key.trim().is_empty() {
        return Ok(ConnectionTestResult::error("请先填写 API Key", 0));
    }

    let base_url = base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "https://api.openai.com/v1".into());
    let model = model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "gpt-4o-mini".into());

    let client = LlmClient::new(api_key, base_url, model);
    Ok(client.test_connection().await)
}

/// 测试 ASR API 连通性
#[tauri::command]
pub async fn test_asr_connection(
    provider: AsrProvider,
    api_key: String,
) -> Result<ConnectionTestResult> {
    if api_key.trim().is_empty() {
        return Ok(ConnectionTestResult::error("请先填写 API Key", 0));
    }

    let result = match provider {
        AsrProvider::DashScope => DashScopeClient::new(api_key).test_connection().await,
        AsrProvider::SenseVoice => SenseVoiceClient::new(api_key).test_connection().await,
    };
    Ok(result)
}

/// 取消正在运行的任务
#[tauri::command]
pub async fn cancel_task(state: State<'_, AppState>, task_id: String) -> Result<()> {
    // 先克隆 CancellationToken，然后释放锁，避免在持有锁时触发其他线程操作
    let cancel_token = {
        let handles = state.task_handles.lock().unwrap();
        handles.get(&task_id).map(|(_, ct)| ct.clone())
    };

    if let Some(token) = cancel_token {
        token.cancel();
        Ok(())
    } else {
        Err(crate::error::AppError::StoreError(
            "任务不存在或已完成".into(),
        ))
    }
}

/// 取消所有正在运行的任务（用于应用退出时）
pub fn cancel_all_tasks(app: &AppHandle, state: &AppState) {
    // 触发全局取消令牌
    state.global_cancel.cancel();

    // 清理任务句柄
    let mut handles = state.task_handles.lock().unwrap();
    for (_, (handle, _)) in handles.drain() {
        handle.abort();
    }

    // 清理任务状态
    state.tasks.lock().unwrap().clear();

    // 退出时强制把活跃任务计数清零并删除 .task_running 标志，
    // 避免 abort 的任务来不及 drop guard 而残留标志文件，下次启动误判。
    state.active_tasks.store(0, Ordering::SeqCst);
    set_task_flag_file(app, false);
}

// ============================
// 扫码登录相关命令
// ============================

/// 生成 QR 码登录信息
#[tauri::command]
pub async fn qrcode_generate() -> Result<QrcodeInfo> {
    let auth = BiliAuth::new();
    auth.generate_qrcode().await
}

/// 轮询 QR 码扫码状态
///
/// 成功时自动保存凭证到 config
#[tauri::command]
pub async fn qrcode_poll(
    state: State<'_, AppState>,
    qrcode_key: String,
) -> Result<QrcodePollResult> {
    let auth = BiliAuth::new();
    let result = auth.poll_qrcode(&qrcode_key).await?;

    // 登录成功时自动保存凭证
    if result.status == "success" {
        if let Some(ref creds) = result.credentials {
            persist_bili_credentials(&state.store, creds)?;
        }
    }

    Ok(result)
}

/// 获取当前登录状态（增强版：自动尝试刷新过期 Cookie）
#[tauri::command]
pub async fn get_login_status(state: State<'_, AppState>) -> Result<LoginStatus> {
    let config = state.store.lock().unwrap().load_config()?;

    let sessdata = match config
        .bilibili_sessdata
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        Some(sd) => sd.to_string(),
        None => {
            return Ok(LoginStatus {
                is_login: false,
                uname: None,
            })
        }
    };

    let bili = BilibiliClient::new();
    let status = bili.check_login_status(&sessdata).await?;

    if status.is_login {
        return Ok(status);
    }

    // Cookie 已过期，尝试自动刷新
    let bili_jct = config
        .bilibili_bili_jct
        .as_deref()
        .filter(|s| !s.is_empty());
    let refresh_token = config
        .bilibili_refresh_token
        .as_deref()
        .filter(|s| !s.is_empty());

    if let (Some(jct), Some(rt)) = (bili_jct, refresh_token) {
        eprintln!("[auth] SESSDATA 过期，尝试自动刷新...");
        let auth = BiliAuth::new();
        match auth.try_refresh_cookie(&sessdata, jct, rt).await {
            Ok(RefreshResult::Success(new_creds)) => {
                persist_bili_credentials(&state.store, &new_creds)?;

                // 用新 SESSDATA 重新验证
                let new_status = bili.check_login_status(&new_creds.sessdata).await?;
                return Ok(new_status);
            }
            Ok(RefreshResult::NotNeeded) => {
                eprintln!("[auth] Cookie 不需要刷新（但验证失败，可能是其他问题）");
            }
            Ok(RefreshResult::Failed(msg)) => {
                eprintln!("[auth] Cookie 刷新失败: {}", msg);
            }
            Err(e) => {
                eprintln!("[auth] Cookie 刷新出错: {}", e);
            }
        }
    }

    // 刷新失败或无刷新凭证
    Ok(LoginStatus {
        is_login: false,
        uname: None,
    })
}

/// 登出 B 站账号（清除所有凭证）
#[tauri::command]
pub async fn logout_bilibili(state: State<'_, AppState>) -> Result<()> {
    clear_bili_credentials(&state.store)?;
    Ok(())
}

// ============================
// 自动刷新集成辅助函数
// ============================

/// 在转录流程中尝试自动刷新 Cookie
///
/// 返回 (是否登录有效, 实际使用的 sessdata)
async fn try_auto_refresh_sessdata(
    config: &AppConfig,
    store: &Mutex<Store>,
    app: &tauri::AppHandle,
    task_id: &str,
) -> SubtitleAccessDecision {
    let sessdata = match config
        .bilibili_sessdata
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        Some(sd) => sd.to_string(),
        None => {
            return SubtitleAccessDecision {
                use_subtitle: false,
                sessdata: None,
                unavailable_reason: Some(
                    "未检测到有效的 B站登录态，当前模式不会发起字幕请求".into(),
                ),
            }
        }
    };

    let bili = BilibiliClient::new();
    emit_progress(app, "transcribe:progress", task_id, "正在验证登录态...");

    match bili.check_login_status(&sessdata).await {
        Ok(status) if status.is_login => {
            emit_progress(
                app,
                "transcribe:progress",
                task_id,
                format!(
                    "登录验证成功（{}），正在检查字幕...",
                    status.uname.unwrap_or_default()
                ),
            );
            return SubtitleAccessDecision {
                use_subtitle: true,
                sessdata: Some(sessdata),
                unavailable_reason: None,
            };
        }
        Ok(_) => {
            // 过期，尝试刷新
            let bili_jct = config
                .bilibili_bili_jct
                .as_deref()
                .filter(|s| !s.is_empty());
            let refresh_token = config
                .bilibili_refresh_token
                .as_deref()
                .filter(|s| !s.is_empty());

            if let (Some(jct), Some(rt)) = (bili_jct, refresh_token) {
                emit_progress(
                    app,
                    "transcribe:progress",
                    task_id,
                    "SESSDATA 已过期，正在自动刷新...",
                );
                let auth = BiliAuth::new();
                match auth.try_refresh_cookie(&sessdata, jct, rt).await {
                    Ok(RefreshResult::Success(new_creds)) => {
                        if let Err(e) = persist_bili_credentials(store, &new_creds) {
                            eprintln!("[auth] 保存刷新后的凭证失败: {}", e);
                        }

                        emit_progress(
                            app,
                            "transcribe:progress",
                            task_id,
                            "Cookie 刷新成功，继续处理...",
                        );

                        // 用新 SESSDATA 验证
                        if let Ok(new_status) = bili.check_login_status(&new_creds.sessdata).await {
                            if new_status.is_login {
                                emit_progress(
                                    app,
                                    "transcribe:progress",
                                    task_id,
                                    format!(
                                        "登录验证成功（{}），正在检查字幕...",
                                        new_status.uname.unwrap_or_default()
                                    ),
                                );
                                return SubtitleAccessDecision {
                                    use_subtitle: true,
                                    sessdata: Some(new_creds.sessdata),
                                    unavailable_reason: None,
                                };
                            }
                        }
                    }
                    _ => {
                        emit_progress(
                            app,
                            "transcribe:progress",
                            task_id,
                            "Cookie 刷新失败，将使用 ASR 转录",
                        );
                        return SubtitleAccessDecision {
                            use_subtitle: false,
                            sessdata: None,
                            unavailable_reason: Some(
                                "B站登录态已过期，自动续期失败，无法请求字幕".into(),
                            ),
                        };
                    }
                }
            } else {
                emit_progress(
                    app,
                    "transcribe:progress",
                    task_id,
                    "SESSDATA 已过期，将使用 ASR 转录（扫码登录可获得自动刷新能力）",
                );
                return SubtitleAccessDecision {
                    use_subtitle: false,
                    sessdata: None,
                    unavailable_reason: Some(
                        "B站登录态已过期，且缺少自动续期凭证，无法请求字幕".into(),
                    ),
                };
            }
        }
        Err(_) => {
            emit_progress(
                app,
                "transcribe:progress",
                task_id,
                "登录态验证失败，将使用 ASR 转录",
            );
            return SubtitleAccessDecision {
                use_subtitle: false,
                sessdata: None,
                unavailable_reason: Some("B站登录态校验失败，当前模式未继续请求字幕".into()),
            };
        }
    }

    SubtitleAccessDecision {
        use_subtitle: false,
        sessdata: None,
        unavailable_reason: Some("当前无法确认字幕访问条件，已回退到 ASR".into()),
    }
}

fn persist_bili_credentials(store: &Mutex<Store>, creds: &BiliCredentials) -> Result<()> {
    let store = store.lock().unwrap();
    let mut config = store.load_config()?;
    config.bilibili_sessdata = Some(creds.sessdata.clone());
    config.bilibili_bili_jct = Some(creds.bili_jct.clone());
    config.bilibili_refresh_token = Some(creds.refresh_token.clone());
    config.bilibili_dede_user_id = Some(creds.dede_user_id.clone());
    config.bilibili_cookie_ts = Some(chrono::Utc::now().timestamp());
    store.save_config(&config)
}

fn clear_bili_credentials(store: &Mutex<Store>) -> Result<()> {
    let store = store.lock().unwrap();
    let mut config = store.load_config()?;
    config.bilibili_sessdata = None;
    config.bilibili_bili_jct = None;
    config.bilibili_refresh_token = None;
    config.bilibili_dede_user_id = None;
    config.bilibili_cookie_ts = None;
    store.save_config(&config)
}

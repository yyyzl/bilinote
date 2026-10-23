//! Private, privacy-safe bridge for Android ongoing task notifications.
use crate::commands::TaskInfo;
use std::collections::HashMap;

pub(crate) fn record_progress(tasks: &mut HashMap<String, TaskInfo>, id: &str, message: &str) {
    if let Some(info) = tasks.get_mut(id) {
        if matches!(info.status.as_str(), "queued" | "running") {
            info.progress = message.to_owned();
        }
    }
}

#[cfg(any(target_os = "android", test))]
use std::{io, path::PathBuf};

#[cfg(any(target_os = "android", test))]
#[derive(serde::Serialize)]
struct Snapshot {
    version: u8,
    session_id: String,
    task_id: String,
    note_id: Option<String>,
    stage: &'static str,
    active_count: usize,
    queued_count: usize,
    updated_at: u64,
}

#[cfg(any(target_os = "android", test))]
impl Snapshot {
    fn select(tasks: &HashMap<String, TaskInfo>, session_id: &str, now: u64) -> Option<Self> {
        let mut active: Vec<_> = tasks
            .iter()
            .filter(|(_, t)| matches!(t.status.as_str(), "queued" | "running"))
            .collect();
        active.sort_by_key(|(id, t)| (t.status == "queued", t.created_at, *id));
        let (id, task) = active.first()?;
        Some(Self {
            version: 1,
            session_id: session_id.into(),
            task_id: (*id).clone(),
            note_id: task.note_id.clone(),
            stage: stage(task),
            active_count: active.len(),
            queued_count: active.iter().filter(|(_, t)| t.status == "queued").count(),
            updated_at: now,
        })
    }
}

#[cfg(any(target_os = "android", test))]
fn stage(task: &TaskInfo) -> &'static str {
    // Multi-part progress prefixes contain arbitrary video titles. Match emitted phrases,
    // not broad keywords such as "summary" or "subtitle" which may occur in those titles.
    let message = task.progress.trim_end_matches(['.', '…']);
    if task.status == "queued" {
        "queued"
    } else if message.ends_with("正在下载音频") {
        "downloading"
    } else if message.ends_with(" 转录") {
        "transcribing"
    } else if message.ends_with("获取视频信息") || message.ends_with("获取分P列表") {
        "fetching"
    } else if message.ends_with("获取字幕") || message.ends_with("字幕获取成功") {
        "subtitles"
    } else if message.ends_with("正在保存") {
        "saving"
    } else if message.contains("失败，正在重试") {
        "retrying"
    } else if message.starts_with("正在生成 AI 总结和思维导图") {
        "summary_mindmap"
    } else if message.starts_with("思维导图产出中")
        || message.starts_with("正在生成思维导图")
        || message.starts_with("生成思维导图")
    {
        "mindmap"
    } else if message.starts_with("总结产出中")
        || message.starts_with("AI 总结产出中")
        || message.starts_with("正在生成 AI 总结")
        || message.starts_with("正在生成总结")
        || message.starts_with("生成总结")
    {
        "summary"
    } else {
        "processing"
    }
}

#[cfg(any(target_os = "android", test))]
struct Publisher {
    path: PathBuf,
    session_id: String,
    flag_stamp: Option<std::time::SystemTime>,
}

#[cfg(any(target_os = "android", test))]
impl Publisher {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            session_id: String::new(),
            flag_stamp: None,
        }
    }

    fn observe_batch(&mut self, stamp: Option<std::time::SystemTime>) {
        // The existing RAII flag is recreated at 0 -> 1 active tasks. Its timestamp
        // distinguishes a new batch even when the idle gap falls between two polls.
        if stamp.is_some() && stamp != self.flag_stamp {
            self.session_id.clear();
            self.flag_stamp = stamp;
        }
    }

    fn publish(&mut self, tasks: &HashMap<String, TaskInfo>, now: u64) -> io::Result<()> {
        if self.session_id.is_empty() {
            self.session_id = uuid::Uuid::new_v4().to_string();
        }
        let Some(snapshot) = Snapshot::select(tasks, &self.session_id, now) else {
            return self.clear();
        };
        let bytes = serde_json::to_vec(&snapshot).map_err(io::Error::other)?;
        let temp = self.path.with_extension("tmp");
        std::fs::write(&temp, bytes)?;
        std::fs::rename(temp, &self.path)
    }

    fn clear(&mut self) -> io::Result<()> {
        self.session_id.clear();
        self.flag_stamp = None;
        for path in [&self.path, &self.path.with_extension("tmp")] {
            if let Err(error) = std::fs::remove_file(path) {
                if error.kind() != io::ErrorKind::NotFound {
                    return Err(error);
                }
            }
        }
        Ok(())
    }
}

/// The worker belongs to the Rust process, not to an Activity or a visible WebView.
#[cfg(target_os = "android")]
pub(crate) fn start(app: tauri::AppHandle) {
    use crate::commands::AppState;
    use tauri::Manager;
    let Ok(dir) = app.path().data_dir() else {
        eprintln!("[live-notification] app data directory unavailable");
        return;
    };
    let mut publisher = Publisher::new(dir.join(".live_task_state.json"));
    let flag_path = dir.join(".task_running");
    if let Err(error) = publisher.clear() {
        eprintln!("[live-notification] startup cleanup failed: {error}");
    }
    let cancel = app.state::<AppState>().global_cancel.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = interval.tick() => {
                    publisher.observe_batch(std::fs::metadata(&flag_path).and_then(|m| m.modified()).ok());
                    // Release the registry lock before serializing or touching the filesystem.
                    let tasks = app.state::<AppState>().tasks.lock().unwrap().clone();
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
                    if let Err(error) = publisher.publish(&tasks, now) {
                        // Notification failures must never fail a paid ASR/LLM task.
                        eprintln!("[live-notification] snapshot update failed: {error}");
                    }
                }
            }
        }
        if let Err(error) = publisher.clear() {
            eprintln!("[live-notification] shutdown cleanup failed: {error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::TaskInfo;
    use std::collections::HashMap;

    fn task(status: &str, progress: &str, kind: &str, created_at: u64) -> TaskInfo {
        TaskInfo {
            status: status.into(),
            progress: progress.into(),
            kind: kind.into(),
            created_at,
            note_id: Some("note-1".into()),
            error: None,
            bvid: None,
            source_url: None,
        }
    }

    #[test]
    fn selection_prefers_running_then_oldest_and_excludes_terminal_tasks() {
        let tasks = HashMap::from([
            ("queued".into(), task("queued", "", "transcribe", 1)),
            (
                "running-b".into(),
                task("running", "正在下载音频...", "transcribe", 2),
            ),
            (
                "running-a".into(),
                task("running", "正在使用 ASR 转录...", "transcribe", 2),
            ),
            ("done".into(), task("completed", "完成", "transcribe", 0)),
            ("failed".into(), task("failed", "失败", "summarize", 0)),
            ("cancelled".into(), task("cancelled", "取消", "mindmap", 0)),
        ]);
        let value = Snapshot::select(&tasks, "batch-1", 100).unwrap();
        assert_eq!(value.task_id, "running-a");
        assert_eq!(value.stage, "transcribing");
        assert_eq!(value.active_count, 3);
        assert_eq!(value.queued_count, 1);
        assert_eq!(value.note_id.as_deref(), Some("note-1"));
    }

    #[test]
    fn stages_are_real_and_never_publish_provider_errors_or_private_content() {
        for (progress, expected) in [
            ("正在下载音频...", "downloading"),
            ("P1/2 (总结与思维导图教程) 正在下载音频...", "downloading"),
            (
                "P1/2 (字幕教程) 正在使用 SenseVoice 转录...",
                "transcribing",
            ),
            ("正在获取视频信息...", "fetching"),
            ("正在获取字幕...", "subtitles"),
            ("AI 总结产出中 · 已生成 39 字", "summary"),
            ("正在生成 AI 总结和思维导图...", "summary_mindmap"),
            ("思维导图产出中 · 已生成 8 字", "mindmap"),
            (
                "音频下载失败，正在重试 (1/3): SECRET_URL_AND_KEY",
                "retrying",
            ),
            ("unrecognized SECRET_TEXT", "processing"),
        ] {
            let tasks =
                HashMap::from([("task-1".into(), task("running", progress, "transcribe", 1))]);
            let value = Snapshot::select(&tasks, "batch-1", 100).unwrap();
            assert_eq!(value.stage, expected, "{progress}");
            let json = serde_json::to_string(&value).unwrap();
            assert!(!json.contains("SECRET"));
            assert!(!json.contains("percent"));
        }
    }

    #[test]
    fn queued_tasks_and_terminal_only_registry_have_distinct_states() {
        let mut tasks = HashMap::from([("task-1".into(), task("queued", "", "summarize", 1))]);
        assert_eq!(
            Snapshot::select(&tasks, "batch", 100).unwrap().stage,
            "queued"
        );
        tasks.get_mut("task-1").unwrap().status = "failed".into();
        assert!(Snapshot::select(&tasks, "batch", 100).is_none());
    }

    #[test]
    fn progress_updates_only_active_records_without_changing_identity() {
        let mut tasks = HashMap::from([("task-1".into(), task("running", "old", "summarize", 1))]);
        record_progress(&mut tasks, "task-1", "new");
        assert_eq!(tasks["task-1"].progress, "new");
        assert_eq!(tasks["task-1"].note_id.as_deref(), Some("note-1"));
        tasks.get_mut("task-1").unwrap().status = "completed".into();
        record_progress(&mut tasks, "task-1", "late callback");
        record_progress(&mut tasks, "unknown", "ignored");
        assert_eq!(tasks["task-1"].progress, "new");
        assert_eq!(tasks.len(), 1);
    }

    #[test]
    fn flag_generation_distinguishes_batches_without_observing_an_idle_tick() {
        let mut publisher = Publisher::new(PathBuf::from("unused"));
        let first = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1);
        let next = first + std::time::Duration::from_secs(1);
        publisher.observe_batch(Some(first));
        publisher.session_id = "batch-1".into();
        publisher.observe_batch(Some(first));
        publisher.observe_batch(None); // Temporary metadata read failure must not restart a batch.
        assert_eq!(publisher.session_id, "batch-1");
        publisher.observe_batch(Some(next));
        assert!(publisher.session_id.is_empty());
    }

    #[test]
    fn publisher_atomically_updates_heartbeat_and_preserves_batch_until_idle() {
        let dir = std::env::temp_dir().join(format!("binote-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        let mut publisher = Publisher::new(path.clone());
        let mut tasks = HashMap::from([(
            "task-1".into(),
            task("running", "正在下载音频", "transcribe", 1),
        )]);
        publisher.publish(&tasks, 100).unwrap();
        let first: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        tasks.insert("task-2".into(), task("running", "生成总结", "summarize", 2));
        tasks.remove("task-1");
        publisher.publish(&tasks, 101).unwrap();
        let second: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(first["session_id"], second["session_id"]);
        assert_eq!(second["task_id"], "task-2");
        assert_eq!(second["updated_at"], 101);
        publisher.publish(&HashMap::new(), 102).unwrap();
        assert!(!path.exists());
        publisher.publish(&tasks, 103).unwrap();
        let third: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_ne!(first["session_id"], third["session_id"]);
        publisher.clear().unwrap();
        assert!(!path.exists());
        assert!(!path.with_extension("tmp").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

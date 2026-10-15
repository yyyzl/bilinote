use crate::connection_test::{network_error_message, status_to_result, ConnectionTestResult};
use crate::error::{AppError, Result};
use crate::retry::{retry_async, RetryConfig, RetryContext};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);
const TEST_TIMEOUT: Duration = Duration::from_secs(15);

/// 流式进度回调的节流间隔
const STREAM_PROGRESS_INTERVAL: Duration = Duration::from_millis(350);

const SUMMARY_SYSTEM: &str = "你是一个专业的视频笔记助手，擅长从视频内容中提取关键信息并生成结构清晰、重点突出的学习笔记。你的笔记风格简洁专业，善于使用 Markdown 格式让内容层次分明、易于阅读。";
const MINDMAP_SYSTEM: &str = "你是一个专业的思维导图生成助手，擅长从视频内容中提取核心概念和层级关系，生成结构清晰的 Mermaid 思维导图代码。";

#[derive(Clone)]
pub struct LlmClient {
    client: Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl LlmClient {
    pub fn new(api_key: String, base_url: String, model: String) -> Self {
        Self {
            client: Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                .build()
                .unwrap_or_else(|_| Client::new()),
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
            model,
        }
    }

    pub async fn summarize(&self, transcript: &str, title: &str) -> Result<String> {
        let request = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: SUMMARY_SYSTEM.into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: build_summary_prompt(title, transcript),
                },
            ],
        };

        let url = format!("{}/chat/completions", self.base_url);
        let resp: ChatResponse = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?
            .json()
            .await
            .map_err(|e| AppError::LlmError(e.to_string()))?;

        if let Some(err) = resp.error {
            return Err(AppError::LlmError(err.message));
        }

        let content = resp
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default();

        Ok(content)
    }

    /// 带重试的总结
    pub async fn summarize_with_retry(
        &self,
        transcript: &str,
        title: &str,
        on_retry: Option<impl Fn(RetryContext)>,
    ) -> Result<String> {
        let config = RetryConfig::default();
        let transcript = transcript.to_string();
        let title = title.to_string();

        retry_async(
            config,
            || async { self.summarize(&transcript, &title).await },
            on_retry,
        )
        .await
    }

    /// 流式总结：边接收边通过 `on_progress` 回调已生成字符数
    pub async fn summarize_stream(
        &self,
        transcript: &str,
        title: &str,
        on_progress: impl Fn(usize),
    ) -> Result<String> {
        let request = StreamChatRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: SUMMARY_SYSTEM.into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: build_summary_prompt(title, transcript),
                },
            ],
            stream: true,
        };

        self.stream_chat(&request, on_progress).await
    }

    /// 带重试的流式总结
    pub async fn summarize_stream_with_retry(
        &self,
        transcript: &str,
        title: &str,
        on_retry: Option<impl Fn(RetryContext)>,
        on_progress: impl Fn(usize) + Clone,
    ) -> Result<String> {
        let config = RetryConfig::default();
        let transcript = transcript.to_string();
        let title = title.to_string();

        retry_async(
            config,
            || async {
                self.summarize_stream(&transcript, &title, on_progress.clone())
                    .await
            },
            on_retry,
        )
        .await
    }

    pub async fn generate_mindmap(&self, transcript: &str, title: &str) -> Result<String> {
        let request = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: MINDMAP_SYSTEM.into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: build_mindmap_prompt(title, transcript),
                },
            ],
        };

        let url = format!("{}/chat/completions", self.base_url);
        let resp: ChatResponse = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?
            .json()
            .await
            .map_err(|e| AppError::LlmError(e.to_string()))?;

        if let Some(err) = resp.error {
            return Err(AppError::LlmError(err.message));
        }

        let content = resp
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default();

        Ok(clean_mindmap(&content))
    }

    /// 带重试的思维导图生成
    pub async fn generate_mindmap_with_retry(
        &self,
        transcript: &str,
        title: &str,
        on_retry: Option<impl Fn(RetryContext)>,
    ) -> Result<String> {
        let config = RetryConfig::default();
        let transcript = transcript.to_string();
        let title = title.to_string();

        retry_async(
            config,
            || async { self.generate_mindmap(&transcript, &title).await },
            on_retry,
        )
        .await
    }

    /// 流式思维导图生成：边接收边通过 `on_progress` 回调已生成字符数
    pub async fn generate_mindmap_stream(
        &self,
        transcript: &str,
        title: &str,
        on_progress: impl Fn(usize),
    ) -> Result<String> {
        let request = StreamChatRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: MINDMAP_SYSTEM.into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: build_mindmap_prompt(title, transcript),
                },
            ],
            stream: true,
        };

        let content = self.stream_chat(&request, on_progress).await?;
        Ok(clean_mindmap(&content))
    }

    /// 带重试的流式思维导图生成
    pub async fn generate_mindmap_stream_with_retry(
        &self,
        transcript: &str,
        title: &str,
        on_retry: Option<impl Fn(RetryContext)>,
        on_progress: impl Fn(usize) + Clone,
    ) -> Result<String> {
        let config = RetryConfig::default();
        let transcript = transcript.to_string();
        let title = title.to_string();

        retry_async(
            config,
            || async {
                self.generate_mindmap_stream(&transcript, &title, on_progress.clone())
                    .await
            },
            on_retry,
        )
        .await
    }

    /// 流式聊天核心：解析 SSE 数据流，累计内容，按节流间隔回调已生成字符数。
    /// 行内字节累积到换行后再做 UTF-8 解码，避免多字节字符跨 chunk 截断导致乱码。
    async fn stream_chat(
        &self,
        request: &StreamChatRequest,
        on_progress: impl Fn(usize),
    ) -> Result<String> {
        let url = format!("{}/chat/completions", self.base_url);
        let mut resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(request)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let detail = if body.is_empty() {
                String::new()
            } else {
                format!(" - {}", body)
            };
            return Err(AppError::LlmError(format!("HTTP {}{}", status, detail)));
        }

        let mut buffer: Vec<u8> = Vec::new();
        let mut content = String::new();
        let mut last_emit = Instant::now();

        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?
        {
            buffer.extend_from_slice(&chunk);

            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line_bytes);
                let line = line.trim();

                let data = match line.strip_prefix("data:") {
                    Some(rest) => rest.trim(),
                    None => continue,
                };
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }

                if let Ok(parsed) = serde_json::from_str::<StreamChunk>(data) {
                    if let Some(choice) = parsed.choices.into_iter().next() {
                        if let Some(piece) = choice.delta.content {
                            content.push_str(&piece);
                            if last_emit.elapsed() >= STREAM_PROGRESS_INTERVAL {
                                on_progress(content.chars().count());
                                last_emit = Instant::now();
                            }
                        }
                    }
                }
            }
        }

        on_progress(content.chars().count());
        Ok(content)
    }

    /// 测试 LLM API 连通性
    pub async fn test_connection(&self) -> ConnectionTestResult {
        let client = match Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TEST_TIMEOUT)
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                return ConnectionTestResult::error(format!("HTTP 客户端初始化失败: {}", e), 0)
            }
        };

        let request = ChatRequest {
            model: self.model.clone(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "hi".into(),
            }],
        };

        let url = format!("{}/chat/completions", self.base_url);
        let started = Instant::now();

        let response = match client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let latency = started.elapsed().as_millis() as u64;
                return ConnectionTestResult::error(network_error_message(&e), latency);
            }
        };

        let status = response.status();
        let latency = started.elapsed().as_millis() as u64;

        if status.is_success() {
            match response.json::<ChatResponse>().await {
                Ok(resp) if resp.error.is_none() => ConnectionTestResult::success(
                    format!("连通正常 · 模型 {} · {}ms", self.model, latency),
                    latency,
                ),
                Ok(resp) => ConnectionTestResult::error(
                    format!(
                        "API 返回错误: {}",
                        resp.error.map(|e| e.message).unwrap_or_default()
                    ),
                    latency,
                ),
                Err(e) => ConnectionTestResult::error(
                    format!("响应解析失败（可能不是 OpenAI 兼容协议）: {}", e),
                    latency,
                ),
            }
        } else {
            let body_text = response.text().await.unwrap_or_default();
            let mut result = status_to_result(status, "LLM", latency, None);
            if !body_text.is_empty() {
                if let Ok(resp) = serde_json::from_str::<ChatResponse>(&body_text) {
                    if let Some(err) = resp.error {
                        result.message = format!("{}（{}）", result.message, err.message);
                    }
                }
            }
            result
        }
    }
}

pub(crate) fn build_summary_prompt(title: &str, transcript: &str) -> String {
    format!(
        r#"请为以下 B站视频生成内容总结与列表预览，在同一次回复中返回一个 JSON 对象，不要附加说明或代码围栏。

视频标题：{title}
转录文本：
{transcript}

JSON 格式：{{"summary":"Markdown 正文", "preview":"纯文本预览"}}

summary 要求：
- 使用 Markdown 标题组织「内容概述」「核心要点」「详细笔记」，有实际精彩观点时可增加「精华金句」。不要给标题添加装饰图标。
- 概述用 2–3 句话，核心要点提取 3–5 条；详细笔记按主题或时间线组织，关键词加粗。
- 严格基于转录，禁止编造。文本过短、不完整或与标题不符时在正文开头明确说明；短内容适当精简。

preview 要求：
- 约 30–50 个汉字，提炼具体内容、结论或关键洞见，帮助读者区分这条笔记。
- 不重复标题，不使用「本视频主要介绍」「这是一份关于」等泛化开头，不含 Markdown、换行、图标。
- 仅基于实际转录；内容不足时如实简短描述，不为凑字数编造。
JSON 字符串内换行、引号必须正确转义。"#
    )
}

pub(crate) fn build_mindmap_prompt(title: &str, transcript: &str) -> String {
    format!(
        r#"请根据以下视频内容生成一个 Mermaid 思维导图。

## 视频标题
{}

## 转录文本
{}

---

请按照以下要求输出：

1. **严格基于转录文本内容生成，禁止编造转录中没有的信息**
2. 如果转录内容过短或与标题不相关，只基于实际内容生成简化的思维导图
3. 使用 Mermaid mindmap 语法
4. 根节点使用视频主题（用双括号包裹，如 `root((主题))`）
5. 提取 3-5 个核心主题作为一级节点
6. 每个一级节点下可以有 2-4 个子节点
7. 层级不超过 3 层
8. 节点文字简洁，每个节点不超过 10 个字
9. 不要使用特殊字符（括号、引号等），避免语法错误
10. 只输出 Mermaid 代码，不要包含 ```mermaid 代码块标记

示例格式：
mindmap
  root((视频主题))
    核心概念1
      要点1
      要点2
    核心概念2
      要点3
      要点4
    核心概念3
      要点5"#,
        title, transcript
    )
}

/// 清理 LLM 返回的 Mermaid 代码中可能残留的 markdown 代码块标记
pub(crate) fn clean_mindmap(content: &str) -> String {
    content
        .trim()
        .trim_start_matches("```mermaid")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string()
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Serialize)]
struct StreamChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ApiError {
    message: String,
}

#[derive(Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
}

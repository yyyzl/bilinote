use crate::connection_test::{network_error_message, status_to_result, ConnectionTestResult};
use crate::error::{AppError, Result};
use crate::retry::{retry_async, RetryConfig, RetryContext};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const TEST_TIMEOUT: Duration = Duration::from_secs(15);

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
        let prompt = format!(
            r#"请为以下B站视频生成一份结构化的内容总结笔记。

## 视频标题
{}

## 转录文本
{}

---

请按照以下格式输出总结（使用 Markdown 格式）：

### 📋 内容概述
用2-3句话概括视频的主题和核心内容。

### 🎯 核心要点
按照视频内容的逻辑顺序，提取3-5个核心要点，每个要点用简洁的语言描述，突出**关键词**。

### 💡 精华金句
如果视频中有值得记录的精彩表述、观点或金句，提取1-3条（如果没有可以跳过这部分）。

### 📝 详细笔记
按照视频的主题或时间线分段总结，每段包含：
- 小标题（描述该段落主题）
- 具体内容要点

---

要求：
1. **严格基于转录文本内容进行总结，禁止编造转录中没有的信息**
2. 如果转录文本与视频标题明显不相关、内容过短或质量不佳，请在开头明确说明"⚠️ 转录内容可能不完整，以下总结仅基于已有文本"
3. 语言简洁精炼，避免冗余
4. 突出重点内容，使用 **加粗** 标记关键词
5. 保持逻辑清晰，层次分明
6. 如果内容较短，可以适当精简各部分"#,
            title, transcript
        );

        let request = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: "你是一个专业的视频笔记助手，擅长从视频内容中提取关键信息并生成结构清晰、重点突出的学习笔记。你的笔记风格简洁专业，善于使用 Markdown 格式让内容层次分明、易于阅读。".into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: prompt,
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

    pub async fn generate_mindmap(&self, transcript: &str, title: &str) -> Result<String> {
        let prompt = format!(
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
        );

        let request = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: "你是一个专业的思维导图生成助手，擅长从视频内容中提取核心概念和层级关系，生成结构清晰的 Mermaid 思维导图代码。".into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: prompt,
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

        // 清理可能的 markdown 代码块标记
        let cleaned = content
            .trim()
            .trim_start_matches("```mermaid")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string();

        Ok(cleaned)
    }

    /// 测试 LLM API 连通性
    ///
    /// 发起一个最小开销的 chat completion（max_tokens=1），用于校验：
    /// - Base URL 是否可达
    /// - API Key 是否有效
    /// - Model 名称是否存在
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
            // 尝试读取响应体确认协议兼容性
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
            // 非 2xx 返回，提取详细错误信息
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
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
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

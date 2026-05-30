use crate::connection_test::{network_error_message, status_to_result, ConnectionTestResult};
use crate::error::{AppError, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

const ASR_ENDPOINT: &str =
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const TEST_ENDPOINT: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1/models";
const TEST_TIMEOUT: Duration = Duration::from_secs(10);

pub struct DashScopeClient {
    client: Client,
    api_key: String,
}

impl DashScopeClient {
    pub fn new(api_key: String) -> Self {
        // 显式设置超时，避免并发下某个请求被服务端挂起而永久占用并发许可。
        // 时长与 SenseVoice 对齐（qwen3-asr-flash 单次音频上限约 5 分钟）。
        let client = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client, api_key }
    }

    pub async fn transcribe(&self, audio_data: &[u8]) -> Result<String> {
        let audio_base64 = STANDARD.encode(audio_data);
        let audio_uri = format!("data:audio/mp4;base64,{}", audio_base64);

        let request = AsrRequest {
            model: "qwen3-asr-flash".into(),
            input: AsrInput {
                messages: vec![
                    AsrMessage {
                        role: "system".into(),
                        content: vec![AsrContent::Text { text: "".into() }],
                    },
                    AsrMessage {
                        role: "user".into(),
                        content: vec![AsrContent::Audio { audio: audio_uri }],
                    },
                ],
            },
        };

        let resp: AsrResponse = self
            .client
            .post(ASR_ENDPOINT)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&request)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?
            .json()
            .await
            .map_err(|e| AppError::AsrError(e.to_string()))?;

        if let Some(code) = resp.code {
            return Err(AppError::AsrError(format!(
                "DashScope ASR 错误: {}",
                resp.message.unwrap_or(code)
            )));
        }

        let text = resp
            .output
            .and_then(|o| o.choices.into_iter().next())
            .and_then(|c| c.message.content.into_iter().next())
            .and_then(|c| match c {
                AsrContent::Text { text } => Some(text),
                _ => None,
            })
            .unwrap_or_default();

        Ok(text)
    }

    /// 测试 DashScope API Key 连通性
    ///
    /// 通过 GET /compatible-mode/v1/models 验证 Key 有效性，不消耗音频额度。
    pub async fn test_connection(&self) -> ConnectionTestResult {
        let client = match Client::builder().timeout(TEST_TIMEOUT).build() {
            Ok(c) => c,
            Err(e) => {
                return ConnectionTestResult::error(format!("HTTP 客户端初始化失败: {}", e), 0)
            }
        };

        let started = Instant::now();
        let response = match client
            .get(TEST_ENDPOINT)
            .header("Authorization", format!("Bearer {}", self.api_key))
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
        let success_detail = if status.is_success() {
            Some(format!("DashScope Key 有效 · {}ms", latency))
        } else {
            None
        };

        status_to_result(status, "DashScope", latency, success_detail)
    }
}

#[derive(Serialize)]
struct AsrRequest {
    model: String,
    input: AsrInput,
}

#[derive(Serialize)]
struct AsrInput {
    messages: Vec<AsrMessage>,
}

#[derive(Serialize)]
struct AsrMessage {
    role: String,
    content: Vec<AsrContent>,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum AsrContent {
    Text { text: String },
    Audio { audio: String },
}

#[derive(Deserialize)]
struct AsrResponse {
    code: Option<String>,
    message: Option<String>,
    output: Option<AsrOutput>,
}

#[derive(Deserialize)]
struct AsrOutput {
    choices: Vec<AsrChoice>,
}

#[derive(Deserialize)]
struct AsrChoice {
    message: AsrMessageContent,
}

#[derive(Deserialize)]
struct AsrMessageContent {
    content: Vec<AsrContent>,
}

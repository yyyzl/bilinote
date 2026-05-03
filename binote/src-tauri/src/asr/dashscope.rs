use crate::error::{AppError, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};

const ASR_ENDPOINT: &str =
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

pub struct DashScopeClient {
    client: Client,
    api_key: String,
}

impl DashScopeClient {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
        }
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

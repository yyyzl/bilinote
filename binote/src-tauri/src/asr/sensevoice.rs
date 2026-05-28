use super::utils;
use crate::connection_test::{network_error_message, status_to_result, ConnectionTestResult};
use crate::error::{AppError, Result};
use std::time::{Duration, Instant};

const SENSEVOICE_API_URL: &str = "https://api.siliconflow.cn/v1/audio/transcriptions";
const SENSEVOICE_TEST_URL: &str = "https://api.siliconflow.cn/v1/models";
const MODEL: &str = "FunAudioLLM/SenseVoiceSmall";
const TEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct SenseVoiceClient {
    api_key: String,
    client: reqwest::Client,
}

impl SenseVoiceClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: utils::create_http_client(),
        }
    }

    pub async fn transcribe(&self, audio_data: &[u8]) -> Result<String> {
        let form = reqwest::multipart::Form::new().text("model", MODEL).part(
            "file",
            reqwest::multipart::Part::bytes(audio_data.to_vec())
                .file_name("audio.wav")
                .mime_str("audio/wav")
                .map_err(|e| AppError::AsrError(e.to_string()))?,
        );

        let response = self
            .client
            .post(SENSEVOICE_API_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        let status = response.status();

        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .map_err(|e| AppError::NetworkError(e.to_string()))?;
            return Err(AppError::AsrError(format!(
                "SenseVoice API 请求失败 ({}): {}",
                status, error_text
            )));
        }

        let result: serde_json::Value = response
            .json()
            .await
            .map_err(|e| AppError::AsrError(e.to_string()))?;

        let mut text = result["text"]
            .as_str()
            .ok_or_else(|| AppError::AsrError("无法解析 SenseVoice 转录结果".into()))?
            .to_string();

        utils::strip_trailing_punctuation(&mut text);
        Ok(text)
    }

    /// 测试 SenseVoice (硅基流动) API Key 连通性
    ///
    /// 通过 GET /v1/models 验证 Key 有效性，不上传音频。
    pub async fn test_connection(&self) -> ConnectionTestResult {
        let client = match reqwest::Client::builder().timeout(TEST_TIMEOUT).build() {
            Ok(c) => c,
            Err(e) => {
                return ConnectionTestResult::error(format!("HTTP 客户端初始化失败: {}", e), 0)
            }
        };

        let started = Instant::now();
        let response = match client
            .get(SENSEVOICE_TEST_URL)
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
            Some(format!("SenseVoice Key 有效 · {}ms", latency))
        } else {
            None
        };

        status_to_result(status, "SenseVoice", latency, success_detail)
    }
}

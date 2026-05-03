use super::utils;
use crate::error::{AppError, Result};

const SENSEVOICE_API_URL: &str = "https://api.siliconflow.cn/v1/audio/transcriptions";
const MODEL: &str = "FunAudioLLM/SenseVoiceSmall";

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
}

pub mod dashscope;
pub mod sensevoice;
pub mod utils;

use crate::error::Result;
use crate::retry::{retry_async, RetryConfig, RetryContext};
use serde::{Deserialize, Serialize};

pub use dashscope::DashScopeClient;
pub use sensevoice::SenseVoiceClient;

/// ASR 提供商枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AsrProvider {
    #[default]
    DashScope,
    SenseVoice,
}

impl AsrProvider {
    pub fn display_name(&self) -> &'static str {
        match self {
            AsrProvider::DashScope => "阿里云 DashScope",
            AsrProvider::SenseVoice => "SenseVoice (硅基流动)",
        }
    }
}

/// 统一的 ASR 客户端
pub enum AsrClient {
    DashScope(DashScopeClient),
    SenseVoice(SenseVoiceClient),
}

impl AsrClient {
    pub fn new(provider: AsrProvider, api_key: String) -> Self {
        match provider {
            AsrProvider::DashScope => AsrClient::DashScope(DashScopeClient::new(api_key)),
            AsrProvider::SenseVoice => AsrClient::SenseVoice(SenseVoiceClient::new(api_key)),
        }
    }

    pub fn provider_name(&self) -> &'static str {
        match self {
            AsrClient::DashScope(_) => "阿里云 DashScope",
            AsrClient::SenseVoice(_) => "SenseVoice (硅基流动)",
        }
    }

    pub async fn transcribe(&self, audio_data: &[u8]) -> Result<String> {
        match self {
            AsrClient::DashScope(client) => client.transcribe(audio_data).await,
            AsrClient::SenseVoice(client) => client.transcribe(audio_data).await,
        }
    }

    /// 带重试的转录
    pub async fn transcribe_with_retry(
        &self,
        audio_data: &[u8],
        on_retry: Option<impl Fn(RetryContext)>,
    ) -> Result<String> {
        let config = RetryConfig::default();
        let audio_data = audio_data.to_vec();

        retry_async(
            config,
            || async {
                match self {
                    AsrClient::DashScope(client) => client.transcribe(&audio_data).await,
                    AsrClient::SenseVoice(client) => client.transcribe(&audio_data).await,
                }
            },
            on_retry,
        )
        .await
    }
}

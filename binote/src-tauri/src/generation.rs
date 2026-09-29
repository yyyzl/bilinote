use crate::codex::CodexClient;
use crate::error::{AppError, Result};
use crate::llm::{build_mindmap_prompt, build_summary_prompt, clean_mindmap, LlmClient};
use crate::retry::RetryContext;
use crate::store::AppConfig;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LlmProvider {
    #[default]
    Api,
    Codex,
}

#[derive(Clone)]
pub enum GenerationClient {
    Api(LlmClient),
    Codex(CodexClient),
}

impl GenerationClient {
    pub fn from_config(config: &AppConfig, work_dir: PathBuf) -> Result<Self> {
        match config.llm_provider {
            LlmProvider::Api => {
                let key = config
                    .llm_api_key
                    .as_ref()
                    .filter(|key| !key.trim().is_empty())
                    .ok_or_else(|| AppError::LlmError("未配置 LLM API Key".into()))?;
                Ok(Self::Api(LlmClient::new(
                    key.clone(),
                    config
                        .llm_base_url
                        .clone()
                        .unwrap_or_else(|| "https://api.openai.com/v1".into()),
                    config
                        .llm_model
                        .clone()
                        .unwrap_or_else(|| "gpt-4o-mini".into()),
                )))
            }
            LlmProvider::Codex => Ok(Self::Codex(CodexClient::new(
                config.codex_model.clone().unwrap_or_default(),
                config.codex_path.clone(),
                config.codex_fast,
                work_dir,
            )?)),
        }
    }

    pub async fn summarize_with_retry(
        &self,
        transcript: &str,
        title: &str,
        on_retry: Option<impl Fn(RetryContext)>,
    ) -> Result<String> {
        match self {
            Self::Api(client) => {
                client
                    .summarize_with_retry(transcript, title, on_retry)
                    .await
            }
            Self::Codex(client) => {
                client
                    .generate(&build_summary_prompt(title, transcript), |_| {})
                    .await
            }
        }
    }

    pub async fn summarize_stream_with_retry(
        &self,
        transcript: &str,
        title: &str,
        on_retry: Option<impl Fn(RetryContext)>,
        on_progress: impl Fn(usize) + Clone,
    ) -> Result<String> {
        match self {
            Self::Api(client) => {
                client
                    .summarize_stream_with_retry(transcript, title, on_retry, on_progress)
                    .await
            }
            Self::Codex(client) => {
                client
                    .generate(&build_summary_prompt(title, transcript), on_progress)
                    .await
            }
        }
    }

    pub async fn generate_mindmap_stream_with_retry(
        &self,
        transcript: &str,
        title: &str,
        on_retry: Option<impl Fn(RetryContext)>,
        on_progress: impl Fn(usize) + Clone,
    ) -> Result<String> {
        match self {
            Self::Api(client) => {
                client
                    .generate_mindmap_stream_with_retry(transcript, title, on_retry, on_progress)
                    .await
            }
            Self::Codex(client) => client
                .generate(&build_mindmap_prompt(title, transcript), on_progress)
                .await
                .map(|text| clean_mindmap(&text)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_config_defaults_to_api_and_requires_key() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(config.llm_provider, LlmProvider::Api);
        assert!(!config.codex_fast);
        assert!(GenerationClient::from_config(&config, std::env::temp_dir()).is_err());
    }

    #[test]
    fn codex_requires_model_but_not_api_key() {
        let mut config = AppConfig {
            llm_provider: LlmProvider::Codex,
            ..Default::default()
        };
        assert!(GenerationClient::from_config(&config, std::env::temp_dir()).is_err());
        config.codex_model = Some("user-chosen-model".into());
        let result = GenerationClient::from_config(&config, std::env::temp_dir());
        assert_eq!(result.is_ok(), crate::codex::supported());
    }
}

use super::*;
use crate::summary_output::parse_summary_output;
use crate::summary_templates::SummaryTemplate;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

const TITLE: &str = "测试标题 {title}";
const TRANSCRIPT: &str = "只记录已知内容。\n{transcript} 是原文，不是占位符。";
const TEMPLATE: &str =
    "  ## 自定义章节\n保留 {title}、{transcript} 和 {\"summary\":\"literal\"}。\n结尾  ";
const OUTPUT: &str =
    r###"{"summary":"## 自定义章节\n记录已知内容。","preview":"只整理实际转录中的已知内容。"}"###;

/// Only loopback traffic, no real account, model, app data or environment mutation.
struct MockApi {
    base_url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    handle: JoinHandle<()>,
}

impl Drop for MockApi {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

impl MockApi {
    async fn start(fail_first: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let handle = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let request: Value = tokio::time::timeout(Duration::from_secs(5), async {
                    let mut bytes = Vec::new();
                    let mut chunk = [0_u8; 8192];
                    let (body_start, body_len) = loop {
                        let read = socket.read(&mut chunk).await.unwrap();
                        assert!(read > 0, "incomplete mock HTTP request");
                        bytes.extend_from_slice(&chunk[..read]);
                        assert!(bytes.len() < 1_048_576, "unexpectedly large test request");
                        if let Some(index) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                            let headers = String::from_utf8_lossy(&bytes[..index]);
                            let length = headers
                                .lines()
                                .find_map(|line| {
                                    line.to_ascii_lowercase()
                                        .strip_prefix("content-length:")
                                        .map(|value| value.trim().parse::<usize>().unwrap())
                                })
                                .expect("reqwest JSON request must have Content-Length");
                            break (index + 4, length);
                        }
                    };
                    assert!(body_len < 1_048_576);
                    while bytes.len() < body_start + body_len {
                        let read = socket.read(&mut chunk).await.unwrap();
                        assert!(read > 0);
                        bytes.extend_from_slice(&chunk[..read]);
                    }
                    serde_json::from_slice(&bytes[body_start..body_start + body_len]).unwrap()
                })
                .await
                .expect("mock HTTP read timed out");
                let index = {
                    let mut requests = recorded.lock().unwrap();
                    requests.push(request.clone());
                    requests.len()
                };
                let (status, content_type, body) = if fail_first && index == 1 {
                    (
                        "429 Too Many Requests",
                        "application/json",
                        json!({
                            "choices": [], "error": {"message": "rate limit 429"}
                        })
                        .to_string(),
                    )
                } else if request["stream"] == true {
                    let chunk = json!({"choices":[{"delta":{"content": OUTPUT}}]});
                    (
                        "200 OK",
                        "text/event-stream",
                        format!("data: {chunk}\n\ndata: [DONE]\n\n"),
                    )
                } else {
                    (
                        "200 OK",
                        "application/json",
                        json!({
                            "choices": [{"message": {"role": "assistant", "content": OUTPUT}}]
                        })
                        .to_string(),
                    )
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                // Cancellation tests may drop the client before the response is written.
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });
        Self {
            base_url,
            requests,
            handle,
        }
    }

    fn config(&self) -> AppConfig {
        AppConfig {
            llm_api_key: Some("offline-test-key".into()),
            llm_base_url: Some(self.base_url.clone()),
            llm_model: Some("offline-test-model".into()),
            summary_templates: vec![SummaryTemplate {
                id: "course".into(),
                name: "课程笔记".into(),
                content: TEMPLATE.into(),
            }],
            default_summary_template_id: Some("course".into()),
            ..Default::default()
        }
    }

    fn prompts(&self) -> Vec<String> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .map(|request| {
                request["messages"][1]["content"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect()
    }
}

async fn summary(client: &GenerationClient, streaming: bool) -> Result<String> {
    tokio::time::timeout(Duration::from_secs(10), async {
        if streaming {
            client
                .summarize_stream_with_retry(TRANSCRIPT, TITLE, None::<fn(RetryContext)>, |_| {})
                .await
        } else {
            client
                .summarize_with_retry(TRANSCRIPT, TITLE, None::<fn(RetryContext)>)
                .await
        }
    })
    .await
    .expect("offline summary timed out")
}

#[tokio::test]
async fn summary_template_api_uses_custom_instructions_in_both_modes() {
    let api = MockApi::start(false).await;
    let client = GenerationClient::from_config(&api.config(), PathBuf::new()).unwrap();
    for streaming in [false, true] {
        let output = parse_summary_output(&summary(&client, streaming).await.unwrap()).unwrap();
        assert_eq!(output.summary, "## 自定义章节\n记录已知内容。");
        assert!(output.preview.is_some());
    }
    let prompts = api.prompts();
    assert_eq!(prompts.len(), 2, "preview must not cause a second request");
    assert_eq!(
        prompts[0], prompts[1],
        "streaming and non-streaming must share a prompt"
    );
    for prompt in prompts {
        assert!(
            prompt.contains(TEMPLATE),
            "selected instructions must be included verbatim"
        );
        assert!(prompt.contains(TITLE));
        assert!(prompt.contains(TRANSCRIPT));
        assert!(
            !prompt.contains("### 📋 内容概述"),
            "custom template replaces the built-in body format"
        );
        assert!(prompt.contains("禁止编造"));
        assert!(prompt.contains("⚠️ 转录内容可能不完整，以下总结仅基于已有文本"));
        assert!(prompt.contains("约 30–50 个汉字"));
        assert!(prompt.contains(r#"{"summary":"Markdown 正文", "preview":"纯文本预览"}"#));
    }
}

#[tokio::test]
async fn summary_template_invalid_selection_fails_without_an_api_request() {
    let api = MockApi::start(false).await;
    let mut config = api.config();
    config.default_summary_template_id = Some("missing-private-id".into());
    let client = GenerationClient::from_config(&config, PathBuf::new()).unwrap();
    for streaming in [false, true] {
        let error = summary(&client, streaming)
            .await
            .expect_err("invalid template must block summary")
            .to_string();
        assert!(error.contains("默认总结模板不存在"));
        assert!(!error.contains("missing-private-id"));
    }
    assert!(api.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn summary_template_client_snapshot_survives_queue_and_retry() {
    let api = MockApi::start(true).await;
    let mut config = api.config();
    let client = GenerationClient::from_config(&config, PathBuf::new()).unwrap();
    let gate = Arc::new(tokio::sync::Semaphore::new(0));
    let queued_gate = gate.clone();
    let retry_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let retries = retry_count.clone();
    let task = tokio::spawn(async move {
        let _permit = queued_gate.acquire().await.unwrap();
        client
            .summarize_stream_with_retry(
                TRANSCRIPT,
                TITLE,
                Some(move |_: RetryContext| {
                    retries.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }),
                |_| {},
            )
            .await
    });
    config.summary_templates[0].content = "AFTER-ACCEPTANCE".into();
    config.default_summary_template_id = None;
    gate.add_permits(1);
    tokio::time::timeout(Duration::from_secs(10), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let prompts = api.prompts();
    assert_eq!(prompts.len(), 2);
    assert_eq!(retry_count.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(prompts[0], prompts[1]);
    assert!(
        prompts[0].contains(TEMPLATE),
        "queue and retry retain accepted instructions"
    );
    assert!(!prompts[0].contains("AFTER-ACCEPTANCE"));
}

#[tokio::test]
async fn summary_template_builtin_and_mindmap_prompts_remain_unchanged() {
    let api = MockApi::start(false).await;
    let mut config = api.config();
    config.default_summary_template_id = None;
    let client = GenerationClient::from_config(&config, PathBuf::new()).unwrap();
    summary(&client, false).await.unwrap();
    assert_eq!(
        api.prompts()[0],
        crate::llm::build_summary_prompt(TITLE, TRANSCRIPT)
    );

    // Even a semantically invalid summary selection must not disable an independent mindmap.
    config.default_summary_template_id = Some("missing".into());
    let client = GenerationClient::from_config(&config, PathBuf::new()).unwrap();
    tokio::time::timeout(
        Duration::from_secs(5),
        client.generate_mindmap_stream_with_retry(
            TRANSCRIPT,
            TITLE,
            None::<fn(RetryContext)>,
            |_| {},
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        api.prompts()[1],
        crate::llm::build_mindmap_prompt(TITLE, TRANSCRIPT)
    );
}

#[test]
fn summary_template_builder_preserves_default_and_literal_custom_text() {
    use crate::llm::{build_summary_prompt, build_summary_prompt_with_template};
    assert_eq!(
        build_summary_prompt_with_template(TITLE, TRANSCRIPT, None),
        build_summary_prompt(TITLE, TRANSCRIPT)
    );
    let prompt = build_summary_prompt_with_template(TITLE, TRANSCRIPT, Some(TEMPLATE));
    assert!(prompt.contains(TEMPLATE));
    assert!(prompt.contains(TITLE));
    assert!(prompt.contains(TRANSCRIPT));
    assert!(prompt.contains("来源与输出规则优先于模板"));
    assert!(prompt.contains("禁止编造"));
    assert!(prompt.contains("JSON 字符串内换行、引号必须正确转义"));
    assert!(!prompt.contains("### 📋 内容概述"));
}

#[test]
fn summary_template_defaults_match_builtin_and_validation_limits() {
    let defaults = serde_json::to_value(crate::commands::get_summary_template_defaults()).unwrap();
    assert_eq!(defaults["name"], "标准笔记");
    let content = defaults["content"].as_str().unwrap();
    assert!(!content.trim().is_empty());
    assert!(crate::llm::build_summary_prompt(TITLE, TRANSCRIPT).contains(content));
    for section in [
        "### 📋 内容概述",
        "### 🎯 核心要点",
        "### 💡 精华金句",
        "### 📝 详细笔记",
    ] {
        assert!(content.contains(section));
    }
    assert!(!content.contains(TITLE));
    assert!(!content.contains(TRANSCRIPT));
    assert_eq!(
        defaults["limits"],
        json!({
            "max_templates": 50,
            "max_id_bytes": 64,
            "max_name_chars": 80,
            "max_content_chars": 12_000
        })
    );
}

#[tokio::test]
async fn summary_template_acceptance_snapshot_precedes_client_creation() {
    use crate::summary_templates::SummaryTemplateSnapshot;
    let api = MockApi::start(false).await;
    let config = Arc::new(Mutex::new(api.config()));
    let accepted = SummaryTemplateSnapshot::capture(&config.lock().unwrap());
    let worker_config = config.clone();
    let gate = Arc::new(tokio::sync::Semaphore::new(0));
    let worker_gate = gate.clone();
    let task = tokio::spawn(async move {
        let _permit = worker_gate.acquire().await.unwrap();
        let client = GenerationClient::from_config(&worker_config.lock().unwrap(), PathBuf::new())
            .unwrap()
            .with_summary_template(accepted);
        summary(&client, true).await
    });
    {
        let mut settings = config.lock().unwrap();
        settings.summary_templates.clear();
        settings.default_summary_template_id = None;
    }
    gate.add_permits(1);
    tokio::time::timeout(Duration::from_secs(10), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(
        api.prompts()[0].contains(TEMPLATE),
        "deleting the template after acceptance cannot change queued work"
    );
    let next_client =
        GenerationClient::from_config(&config.lock().unwrap(), PathBuf::new()).unwrap();
    summary(&next_client, true).await.unwrap();
    assert_eq!(
        api.prompts()[1],
        crate::llm::build_summary_prompt(TITLE, TRANSCRIPT)
    );
}

#[tokio::test]
async fn summary_template_cancelled_queue_makes_no_request() {
    use crate::summary_templates::SummaryTemplateSnapshot;
    let api = MockApi::start(false).await;
    let config = api.config();
    let accepted = SummaryTemplateSnapshot::capture(&config);
    let gate = tokio::sync::Semaphore::new(0);
    let cancel = tokio_util::sync::CancellationToken::new();
    cancel.cancel();
    tokio::select! {
        _ = cancel.cancelled() => {},
        _permit = gate.acquire() => {
            let client = GenerationClient::from_config(&config, PathBuf::new()).unwrap()
                .with_summary_template(accepted);
            summary(&client, true).await.unwrap();
            panic!("cancelled queue must not start generation");
        }
    }
    assert!(api.requests.lock().unwrap().is_empty());
}

#[test]
fn summary_template_entrypoints_capture_before_enqueue() {
    // Tauri uses a concrete native AppHandle here. This source-level boundary guard
    // complements the executable snapshot/queue tests, not a native invoke test.
    let source = include_str!("commands.rs");
    for name in ["start_summarize", "start_transcribe"] {
        let marker = format!("pub async fn {name}(");
        let body = source.split_once(&marker).unwrap().1;
        let before_enqueue = body.split_once("TaskInfo::queued").unwrap().0;
        assert!(
            before_enqueue.contains("SummaryTemplateSnapshot::capture"),
            "{name} must capture templates before publishing a queued task"
        );
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
struct MockCodex {
    root: PathBuf,
    executable: PathBuf,
    work_dir: PathBuf,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl Drop for MockCodex {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl MockCodex {
    async fn build() -> Self {
        let root =
            std::env::temp_dir().join(format!("binote-summary-codex-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join(if cfg!(target_os = "windows") {
            "fake-codex.exe"
        } else {
            "fake-codex"
        });
        let fixture = Self {
            work_dir: root.join("workspace"),
            root,
            executable,
        };
        let source = fixture.root.join("fixture.rs");
        std::fs::write(&source, include_str!("testdata/codex_summary_fixture.rs")).unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(30),
            tokio::process::Command::new("rustc")
                .args(["--edition=2021", "--crate-name", "binote_codex_fixture"])
                .arg(&source)
                .arg("-o")
                .arg(&fixture.executable)
                .kill_on_drop(true)
                .output(),
        )
        .await
        .expect("fixture compiler timed out")
        .unwrap();
        assert!(
            result.status.success(),
            "fixture compilation failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        fixture
    }

    fn config(&self, mut config: AppConfig) -> AppConfig {
        config.llm_provider = LlmProvider::Codex;
        config.llm_api_key = None;
        config.codex_model = Some("offline-model".into());
        config.codex_path = Some(self.executable.to_string_lossy().into_owned());
        config
    }

    fn prompt(&self) -> String {
        std::fs::read_to_string(self.work_dir.join("fixture-prompt.txt")).unwrap()
    }

    fn exec_count(&self) -> usize {
        std::fs::read_to_string(self.work_dir.join("fixture-calls.txt"))
            .unwrap()
            .lines()
            .filter(|line| *line == "exec")
            .count()
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[tokio::test]
async fn summary_template_codex_matches_api_without_real_codex_or_account() {
    let api = MockApi::start(false).await;
    let fixture = MockCodex::build().await;
    let api_client = GenerationClient::from_config(&api.config(), PathBuf::new()).unwrap();
    let mut config = fixture.config(api.config());
    let codex = GenerationClient::from_config(&config, fixture.work_dir.clone()).unwrap();
    for streaming in [false, true] {
        summary(&api_client, streaming).await.unwrap();
        let output = summary(&codex, streaming).await.unwrap();
        assert!(parse_summary_output(&output).is_ok());
        assert_eq!(fixture.prompt(), api.prompts().last().unwrap().as_str());
        assert!(fixture.prompt().contains(TEMPLATE));
    }
    assert_eq!(
        fixture.exec_count(),
        2,
        "one Codex execution per summary, not per preview"
    );

    config.default_summary_template_id = None;
    let builtin = GenerationClient::from_config(&config, fixture.work_dir.clone()).unwrap();
    summary(&builtin, false).await.unwrap();
    assert_eq!(
        fixture.prompt(),
        crate::llm::build_summary_prompt(TITLE, TRANSCRIPT)
    );

    config.default_summary_template_id = Some("missing-private-id".into());
    let invalid = GenerationClient::from_config(&config, fixture.work_dir.clone()).unwrap();
    let calls = fixture.exec_count();
    for streaming in [false, true] {
        let error = summary(&invalid, streaming).await.unwrap_err().to_string();
        assert!(error.contains("默认总结模板不存在"));
        assert!(!error.contains("missing-private-id"));
    }
    assert_eq!(fixture.exec_count(), calls);
    invalid
        .generate_mindmap_stream_with_retry(TRANSCRIPT, TITLE, None::<fn(RetryContext)>, |_| {})
        .await
        .unwrap();
    assert_eq!(
        fixture.prompt(),
        crate::llm::build_mindmap_prompt(TITLE, TRANSCRIPT)
    );

    let calls = fixture.exec_count();
    std::fs::write(fixture.work_dir.join("fixture-fail-next"), "fail once").unwrap();
    assert!(summary(&codex, false).await.is_err());
    assert_eq!(
        fixture.exec_count(),
        calls + 1,
        "Codex must not acquire API automatic retries"
    );
}

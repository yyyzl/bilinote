use super::{AppConfig, Store, CONFIG_FILE, NOTES_FILE};
use crate::error::AppError;
use serde_json::{json, Value};

struct TestStore {
    store: Store,
}

impl TestStore {
    fn new() -> Self {
        let app_dir =
            std::env::temp_dir().join(format!("binote-summary-templates-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&app_dir).unwrap();
        Self {
            store: Store { app_dir },
        }
    }
}

impl Drop for TestStore {
    fn drop(&mut self) {
        // Best-effort cleanup of this test's unique directory, never real app data.
        let _ = std::fs::remove_dir_all(&self.store.app_dir);
    }
}

fn template(id: &str, name: &str, content: &str) -> Value {
    json!({"id": id, "name": name, "content": content})
}

fn config_with_templates(templates: Value, selected: Value) -> AppConfig {
    serde_json::from_value(json!({
        "summary_templates": templates,
        "default_summary_template_id": selected,
        "llm_model": "test-model",
        "llm_api_key": "test-only-not-a-real-key",
        "auto_mindmap": false
    }))
    .unwrap()
}

fn assert_rejected(templates: Value, selected: Value, message_fragment: &str) {
    let fixture = TestStore::new();
    let config = config_with_templates(templates, selected);
    let error = fixture
        .store
        .save_config(&config)
        .expect_err("invalid template settings must be rejected before writing");
    assert!(matches!(&error, AppError::StoreError(_)));
    assert!(
        error.to_string().contains(message_fragment),
        "expected {message_fragment:?} in {error}"
    );
    assert!(!fixture.store.app_dir.join(CONFIG_FILE).exists());
    assert!(!fixture.store.app_dir.join("config.tmp").exists());
}

#[test]
fn summary_templates_legacy_config_load_does_not_rewrite_file() {
    let fixture = TestStore::new();
    let path = fixture.store.app_dir.join(CONFIG_FILE);
    let original = "{\n  \"llm_model\": \"legacy-model\", \"auto_summary\": false\n}";
    std::fs::write(&path, original).unwrap();

    let config = fixture.store.load_config().unwrap();
    assert_eq!(std::fs::read_to_string(path).unwrap(), original);
    assert_eq!(config.llm_model.as_deref(), Some("legacy-model"));
    assert!(!config.auto_summary);
    let serialized = serde_json::to_value(config).unwrap();
    assert_eq!(serialized.get("summary_templates"), Some(&json!([])));
    assert_eq!(
        serialized.get("default_summary_template_id"),
        Some(&Value::Null)
    );
}

#[test]
fn summary_templates_new_and_missing_configs_use_builtin_default() {
    let fixture = TestStore::new();
    for config in [AppConfig::default(), fixture.store.load_config().unwrap()] {
        let serialized = serde_json::to_value(config).unwrap();
        assert_eq!(serialized.get("summary_templates"), Some(&json!([])));
        assert_eq!(
            serialized.get("default_summary_template_id"),
            Some(&Value::Null)
        );
    }
    assert!(!fixture.store.app_dir.join(CONFIG_FILE).exists());
}

#[test]
fn summary_templates_round_trip_keeps_unicode_and_literal_content() {
    let fixture = TestStore::new();
    let templates = json!([
        template(
            "course-notes",
            "课程笔记 🧠",
            "### 概念\n原样保留 {title}、{transcript} 和 {{braces}}。\n{\"summary\":\"示例\"}"
        ),
        template("quick_notes_2", "快速浏览", "  用三个要点总结。\n")
    ]);
    let config = config_with_templates(templates.clone(), json!("course-notes"));
    fixture.store.save_config(&config).unwrap();
    let saved = serde_json::to_value(fixture.store.load_config().unwrap()).unwrap();
    assert_eq!(saved["summary_templates"], templates);
    assert_eq!(saved["default_summary_template_id"], "course-notes");
    assert_eq!(saved["llm_model"], "test-model");
    assert_eq!(saved["llm_api_key"], "test-only-not-a-real-key");
    assert_eq!(saved["auto_mindmap"], false);
}

#[test]
fn summary_templates_reject_invalid_names() {
    for name in [String::new(), " \t\n".into(), "课".repeat(81)] {
        assert_rejected(
            json!([template("valid-id", &name, "有效内容")]),
            Value::Null,
            "名称",
        );
    }
}

#[test]
fn summary_templates_reject_invalid_content() {
    for content in [String::new(), " \t\n".into(), "字".repeat(12_001)] {
        assert_rejected(
            json!([template("valid-id", "有效名称", &content)]),
            Value::Null,
            "内容",
        );
    }
}

#[test]
fn summary_templates_reject_invalid_ids() {
    for id in [
        "".into(),
        " ".into(),
        "has space".into(),
        "bad/path".into(),
        "中文".into(),
        "a".repeat(65),
    ] {
        assert_rejected(
            json!([template(&id, "课程", "按概念总结")]),
            Value::Null,
            "标识",
        );
    }
}

#[test]
fn summary_templates_reject_duplicate_ids_and_trimmed_names() {
    assert_rejected(
        json!([
            template("same", "课程", "内容一"),
            template("same", "速读", "内容二")
        ]),
        Value::Null,
        "标识重复",
    );
    assert_rejected(
        json!([
            template("one", "课程", "内容一"),
            template("two", " 课程 ", "内容二")
        ]),
        Value::Null,
        "名称重复",
    );
}

#[test]
fn summary_templates_reject_dangling_or_empty_default_id() {
    for selected in ["missing", ""] {
        assert_rejected(json!([]), json!(selected), "默认总结模板不存在");
        assert_rejected(
            json!([template("existing", "课程", "按概念总结")]),
            json!(selected),
            "默认总结模板不存在",
        );
    }
}

#[test]
fn summary_templates_accept_exact_unicode_and_collection_limits() {
    let fixture = TestStore::new();
    let templates: Vec<Value> = (0..50)
        .map(|i| {
            let name = if i == 0 {
                "🧠".repeat(80)
            } else {
                format!("模板 {i}")
            };
            let content = if i == 0 {
                "🧠".repeat(12_000)
            } else {
                "有效内容".into()
            };
            template(&format!("{i:064}"), &name, &content)
        })
        .collect();
    let config = config_with_templates(json!(templates), json!(format!("{:064}", 49)));
    fixture.store.save_config(&config).unwrap();
    let saved = serde_json::to_value(fixture.store.load_config().unwrap()).unwrap();
    assert_eq!(
        saved["summary_templates"].as_array().map(Vec::len),
        Some(50)
    );
    assert_eq!(
        saved["summary_templates"][0]["name"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        80
    );
    assert_eq!(
        saved["summary_templates"][0]["content"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        12_000
    );
    assert_eq!(saved["default_summary_template_id"], format!("{:064}", 49));
}

#[test]
fn summary_templates_reject_too_many_templates() {
    let templates: Vec<Value> = (0..51)
        .map(|i| template(&format!("id-{i}"), &format!("模板 {i}"), "有效内容"))
        .collect();
    assert_rejected(json!(templates), Value::Null, "最多保存 50 个");
}

#[test]
fn summary_templates_invalid_save_preserves_existing_config_and_notes() {
    let fixture = TestStore::new();
    fixture.store.save_config(&AppConfig::default()).unwrap();
    let config_path = fixture.store.app_dir.join(CONFIG_FILE);
    let original = std::fs::read(&config_path).unwrap();
    let notes_path = fixture.store.app_dir.join(NOTES_FILE);
    let notes = br#"{"notes":[{"id":"existing-note","summary":"keep me"}]}"#;
    std::fs::write(&notes_path, notes).unwrap();

    let invalid = config_with_templates(json!([]), json!("missing"));
    assert!(fixture.store.save_config(&invalid).is_err());
    assert_eq!(std::fs::read(config_path).unwrap(), original);
    assert_eq!(std::fs::read(notes_path).unwrap(), notes);
    assert!(!fixture.store.app_dir.join("config.tmp").exists());
}

#[test]
fn summary_templates_reject_malformed_field_types() {
    let invalid_configs = [
        json!({"summary_templates": null}),
        json!({"summary_templates": "not an array"}),
        json!({"summary_templates": [{}]}),
        json!({"summary_templates": [{"id": 1, "name": "课程", "content": "内容"}]}),
        json!({"summary_templates": [{"id": "id", "name": null, "content": "内容"}]}),
        json!({"summary_templates": [{"id": "id", "name": "课程", "content": []}]}),
        json!({"default_summary_template_id": 42}),
    ];
    for value in invalid_configs {
        assert!(serde_json::from_value::<AppConfig>(value).is_err());
    }
}

#[test]
fn summary_templates_account_updates_preserve_template_settings() {
    let fixture = TestStore::new();
    let templates = json!([template("course", "课程笔记", "提取概念和例子")]);
    let config = config_with_templates(templates.clone(), json!("course"));
    fixture.store.save_config(&config).unwrap();

    for session in [Some("test-only-session".to_owned()), None] {
        let mut loaded = fixture.store.load_config().unwrap();
        loaded.bilibili_sessdata = session.clone();
        loaded.bilibili_cookie_ts = session.as_ref().map(|_| 12345);
        fixture.store.save_config(&loaded).unwrap();
        let saved = serde_json::to_value(fixture.store.load_config().unwrap()).unwrap();
        assert_eq!(saved["summary_templates"], templates);
        assert_eq!(saved["default_summary_template_id"], "course");
        assert_eq!(saved["bilibili_sessdata"], json!(session));
    }
}

#[test]
fn summary_templates_can_remove_selected_template_and_restore_builtin() {
    let fixture = TestStore::new();
    let original = json!([
        template("course", "课程", "详细说明"),
        template("quick", "速读", "三个重点")
    ]);
    fixture
        .store
        .save_config(&config_with_templates(original, json!("course")))
        .unwrap();
    let remaining = json!([template("quick", "速读", "三个重点")]);
    fixture
        .store
        .save_config(&config_with_templates(remaining.clone(), Value::Null))
        .unwrap();
    let saved = serde_json::to_value(fixture.store.load_config().unwrap()).unwrap();
    assert_eq!(saved["summary_templates"], remaining);
    assert_eq!(saved.get("default_summary_template_id"), Some(&Value::Null));
}

#[test]
fn summary_templates_empty_library_and_builtin_selection_can_be_saved() {
    let fixture = TestStore::new();
    let config = config_with_templates(json!([]), Value::Null);
    fixture.store.save_config(&config).unwrap();
    assert_eq!(
        fixture.store.load_config().unwrap().llm_model.as_deref(),
        Some("test-model")
    );
}

#[test]
fn summary_templates_validation_errors_do_not_echo_private_settings() {
    let fixture = TestStore::new();
    let config = config_with_templates(
        json!([template("invalid/id", "PRIVATE-NAME", "PRIVATE-CONTENT")]),
        Value::Null,
    );
    let error = fixture
        .store
        .save_config(&config)
        .expect_err("invalid id must fail")
        .to_string();
    assert!(!error.contains("PRIVATE-NAME"));
    assert!(!error.contains("PRIVATE-CONTENT"));
    assert!(!error.contains("test-only-not-a-real-key"));
    assert!(!error.contains("invalid/id"));
}

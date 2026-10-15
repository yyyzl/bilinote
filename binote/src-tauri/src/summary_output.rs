use crate::error::{AppError, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct SummaryOutput {
    pub summary: String,
    #[serde(default, deserialize_with = "deserialize_preview")]
    pub preview: Option<String>,
}

fn deserialize_preview<'de, D>(deserializer: D) -> std::result::Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_str().map(str::to_owned))
}

/// 解析同一次生成的正文与预览。非结构化 Markdown 保留正文，预览由转录回退。
pub fn parse_summary_output(raw: &str) -> Result<SummaryOutput> {
    let raw = raw.trim();
    let content = raw
        .strip_prefix("```json")
        .or_else(|| raw.strip_prefix("```"))
        .and_then(|text| text.trim_end().strip_suffix("```"))
        .unwrap_or(raw)
        .trim();
    if content.is_empty() {
        return Err(AppError::LlmError("模型未返回有效总结".into()));
    }
    let mut output = if content.starts_with('{') || content.starts_with('[') {
        serde_json::from_str::<SummaryOutput>(content)
            .map_err(|_| AppError::LlmError("总结格式不完整，请重新生成".into()))?
    } else {
        SummaryOutput {
            summary: content.to_string(),
            preview: None,
        }
    };
    output.summary = output.summary.trim().to_string();
    if output.summary.is_empty() {
        return Err(AppError::LlmError("模型未返回有效总结".into()));
    }
    output.preview = output
        .preview
        .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|text| !text.is_empty());
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_output_reads_fenced_json_and_keeps_complete_preview() {
        let preview = "通过查询、键和值的加权计算理解注意力机制，并结合位置编码串起整个模型的主要组件与训练过程。";
        let raw = format!(
            "```json\n{}\n```",
            serde_json::json!({"summary":"## 核心要点\n注意力计算。", "preview": preview})
        );
        let output = parse_summary_output(&raw).unwrap();
        assert_eq!(output.summary, "## 核心要点\n注意力计算。");
        assert_eq!(output.preview.as_deref(), Some(preview));
    }

    #[test]
    fn summary_output_allows_markdown_without_preview() {
        let output = parse_summary_output("## 核心要点\n保留实际内容。").unwrap();
        assert!(output.preview.is_none());
        assert!(output.summary.contains("实际内容"));
    }

    #[test]
    fn summary_output_missing_preview_is_optional_but_summary_is_required() {
        let output = parse_summary_output(r#"{"summary":"正文","preview":" \n "}"#).unwrap();
        assert_eq!(output.preview, None);
        for raw in [
            "",
            r#"{"preview":"不能丢失正文"}"#,
            r#"{"summary":" "}"#,
            r#"{"summary": "截断"#,
        ] {
            assert!(parse_summary_output(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn summary_output_normalizes_preview_lines() {
        let output =
            parse_summary_output(r#"{"summary":"正文","preview":"  注意力\n通过加权计算。  "}"#)
                .unwrap();
        assert_eq!(output.preview.as_deref(), Some("注意力 通过加权计算。"));
    }

    #[test]
    fn summary_output_ignores_invalid_preview_without_losing_summary() {
        for value in ["123", "{}", "[]", "null"] {
            let raw = format!(r#"{{"summary":"有效正文","preview":{value}}}"#);
            let output = parse_summary_output(&raw).unwrap();
            assert_eq!(output.summary, "有效正文");
            assert_eq!(output.preview, None);
        }
    }

    #[test]
    fn summary_output_old_note_and_preview_roundtrip() {
        let raw = r#"{"id":"one","bvid":"BV1","title":"测试","cover":"","transcript":"已有原文","summary":null,"mindmap":null,"created_at":1}"#;
        let mut note: crate::store::Note = serde_json::from_str(raw).unwrap();
        assert!(note.preview.is_none());
        note.preview = Some("完整预览正文".into());
        let saved = serde_json::to_string(&note).unwrap();
        let restored: crate::store::Note = serde_json::from_str(&saved).unwrap();
        assert_eq!(restored.preview.as_deref(), Some("完整预览正文"));
        assert_eq!(restored.transcript, "已有原文");
    }
}

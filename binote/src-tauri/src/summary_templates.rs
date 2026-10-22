use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub(crate) const MAX_SUMMARY_TEMPLATES: usize = 50;
pub(crate) const MAX_TEMPLATE_ID_BYTES: usize = 64;
pub(crate) const MAX_TEMPLATE_NAME_CHARS: usize = 80;
pub(crate) const MAX_TEMPLATE_CONTENT_CHARS: usize = 12_000;

/// 用户自定义的总结正文要求；标题、转录和输出协议由应用单独提供。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SummaryTemplate {
    pub id: String,
    pub name: String,
    pub content: String,
}

/// 保存前验证整个模板集合，不改写用户文本，也不在错误中回显配置内容。
/// None 表示使用内置模板；非空选择必须引用现存的自定义模板。
pub(crate) fn validate_summary_templates(
    templates: &[SummaryTemplate],
    default_id: Option<&str>,
) -> Result<()> {
    if templates.len() > MAX_SUMMARY_TEMPLATES {
        return Err(AppError::StoreError(format!(
            "总结模板最多保存 {MAX_SUMMARY_TEMPLATES} 个"
        )));
    }

    let mut ids = HashSet::with_capacity(templates.len());
    let mut names = HashSet::with_capacity(templates.len());
    for template in templates {
        if template.id.is_empty()
            || template.id.len() > MAX_TEMPLATE_ID_BYTES
            || !template
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(AppError::StoreError(format!(
                "总结模板标识必须为 1–{MAX_TEMPLATE_ID_BYTES} 位英文字母、数字、下划线或短横线"
            )));
        }
        if !ids.insert(template.id.as_str()) {
            return Err(AppError::StoreError("总结模板标识重复".into()));
        }

        if template.name.trim().is_empty()
            || template.name.chars().count() > MAX_TEMPLATE_NAME_CHARS
        {
            return Err(AppError::StoreError(format!(
                "总结模板名称不能为空，且不能超过 {MAX_TEMPLATE_NAME_CHARS} 个字符"
            )));
        }
        if !names.insert(template.name.trim()) {
            return Err(AppError::StoreError("总结模板名称重复".into()));
        }

        if template.content.trim().is_empty()
            || template.content.chars().count() > MAX_TEMPLATE_CONTENT_CHARS
        {
            return Err(AppError::StoreError(format!(
                "总结模板内容不能为空，且不能超过 {MAX_TEMPLATE_CONTENT_CHARS} 个字符"
            )));
        }
    }

    if let Some(default_id) = default_id {
        if !ids.contains(default_id) {
            return Err(AppError::StoreError(
                "默认总结模板不存在，请重新选择模板或恢复内置默认".into(),
            ));
        }
    }
    Ok(())
}

const BUILTIN_SUMMARY_TEMPLATE_NAME: &str = "标准笔记";
const BUILTIN_SUMMARY_TEMPLATE_CONTENT: &str = r#"请按照以下格式输出总结（使用 Markdown 格式）：

### 📋 内容概述
用2-3句话概括视频的主题和核心内容。

### 🎯 核心要点
按照视频内容的逻辑顺序，提取3-5个核心要点，每个要点用简洁的语言描述，突出**关键词**。

### 💡 精华金句
如果视频中有值得记录的精彩表述、观点或金句，提取1-3条（如果没有可以跳过这部分）。

### 📝 详细笔记
按照视频的主题或时间线分段总结，每段包含：
- 小标题（描述该段落主题）
- 具体内容要点"#;

/// Owns only the accepted summary instructions (or their validation error), not credentials.
/// Errors are checked by summary generation, so a bad template cannot disable mindmaps.
#[derive(Clone)]
pub struct SummaryTemplateSnapshot {
    instructions: Result<Option<String>>,
}

impl Default for SummaryTemplateSnapshot {
    fn default() -> Self {
        Self {
            instructions: Ok(None),
        }
    }
}

impl SummaryTemplateSnapshot {
    pub(crate) fn capture(config: &crate::store::AppConfig) -> Self {
        let instructions = validate_summary_templates(
            &config.summary_templates,
            config.default_summary_template_id.as_deref(),
        )
        .map(|()| {
            config
                .default_summary_template_id
                .as_deref()
                .and_then(|id| {
                    config
                        .summary_templates
                        .iter()
                        .find(|template| template.id == id)
                })
                .map(|template| template.content.clone())
        });
        Self { instructions }
    }

    pub(crate) fn instructions(&self) -> Result<Option<&str>> {
        self.instructions
            .as_ref()
            .map(|content| content.as_deref())
            .map_err(Clone::clone)
    }
}

#[derive(Serialize)]
pub struct SummaryTemplateLimits {
    pub max_templates: usize,
    pub max_id_bytes: usize,
    pub max_name_chars: usize,
    pub max_content_chars: usize,
}

#[derive(Serialize)]
pub struct SummaryTemplateDefaults {
    pub name: &'static str,
    pub content: &'static str,
    pub limits: SummaryTemplateLimits,
}

pub(crate) fn summary_template_defaults() -> SummaryTemplateDefaults {
    SummaryTemplateDefaults {
        name: BUILTIN_SUMMARY_TEMPLATE_NAME,
        content: BUILTIN_SUMMARY_TEMPLATE_CONTENT,
        limits: SummaryTemplateLimits {
            max_templates: MAX_SUMMARY_TEMPLATES,
            max_id_bytes: MAX_TEMPLATE_ID_BYTES,
            max_name_chars: MAX_TEMPLATE_NAME_CHARS,
            max_content_chars: MAX_TEMPLATE_CONTENT_CHARS,
        },
    }
}

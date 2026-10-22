import type { SummaryTemplate, SummaryTemplateLimits } from "./tauri";

export interface TemplateFieldErrors {
  name?: string;
  content?: string;
}

export interface SummaryTemplateValidation {
  valid: boolean;
  message: string;
  selectionError: string;
  fields: Map<string, TemplateFieldErrors>;
}

// Rust str::trim uses Unicode White_Space (unlike JS trim for U+0085 / U+FEFF).
export const trimTemplateText = (value: string) =>
  value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
export const templateCharCount = (value: string) => Array.from(value).length;

export function validateSummaryTemplates(
  templates: SummaryTemplate[],
  defaultId: string | null,
  limits: SummaryTemplateLimits,
): SummaryTemplateValidation {
  let message = templates.length > limits.max_templates
    ? `总结模板最多保存 ${limits.max_templates} 个`
    : "";
  const ids = new Set<string>();
  const names = new Set<string>();
  const duplicateNames = new Set<string>();
  const fields = new Map<string, TemplateFieldErrors>();
  for (const template of templates) {
    const name = trimTemplateText(template.name);
    if (names.has(name)) duplicateNames.add(name);
    names.add(name);
  }
  for (const template of templates) {
    if (!/^[A-Za-z0-9_-]+$/.test(template.id) || template.id.length > limits.max_id_bytes)
      message ||= "模板标识无效，请删除该模板后重新创建。";
    if (ids.has(template.id)) message ||= "模板标识重复，请删除重复模板后重试。";
    ids.add(template.id);
    const errors: TemplateFieldErrors = {};
    const name = trimTemplateText(template.name);
    if (!name) errors.name = "请输入模板名称。";
    else if (templateCharCount(template.name) > limits.max_name_chars)
      errors.name = `名称不能超过 ${limits.max_name_chars} 个字符。`;
    else if (duplicateNames.has(name)) errors.name = "模板名称重复，请换一个名称。";
    if (!trimTemplateText(template.content)) errors.content = "请输入总结要求。";
    else if (templateCharCount(template.content) > limits.max_content_chars)
      errors.content = `总结要求不能超过 ${limits.max_content_chars} 个字符。`;
    if (errors.name || errors.content) fields.set(template.id, errors);
  }
  const selectionError = defaultId !== null && !ids.has(defaultId)
    ? "默认总结模板不存在，请重新选择模板或恢复内置默认。"
    : "";
  message ||= selectionError || (fields.size ? "模板中有未修正的错误，请检查名称和总结要求。" : "");
  return { valid: !message, message, selectionError, fields };
}

export function newSummaryTemplate(
  templates: SummaryTemplate[],
  baseName: string,
  content: string,
): SummaryTemplate {
  const names = new Set(templates.map((template) => trimTemplateText(template.name)));
  let name = baseName;
  for (let suffix = 2; names.has(name); suffix += 1) name = `${baseName} ${suffix}`;
  // getRandomValues also works in native WebViews without a secure-context randomUUID.
  const id = "t_" + Array.from(crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { id, name, content };
}

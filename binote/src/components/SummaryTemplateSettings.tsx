import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Copy, LockKeyhole, Plus, Trash2 } from "lucide-react";
import type { SummaryTemplate, SummaryTemplateDefaults } from "../lib/tauri";
import {
  newSummaryTemplate,
  templateCharCount,
  trimTemplateText,
  type SummaryTemplateValidation,
} from "../lib/summary-templates";
import ConfirmModal from "./ConfirmModal";

interface SummaryTemplateSelectProps {
  templates: SummaryTemplate[];
  value: string | null;
  defaults: SummaryTemplateDefaults;
  onChange: (id: string | null) => void;
  error?: string;
  isInline?: boolean;
}

export function SummaryTemplateSelect({
  templates, value, defaults, onChange, error, isInline = false,
}: SummaryTemplateSelectProps) {
  const id = useId();
  const missing = value !== null && !templates.some((template) => template.id === value);
  // Empty string is only the UI sentinel. Even a corrupt persisted "" remains an explicit error.
  const selected = missing ? `missing:${value}` : value ?? "";
  return (
    <div className={isInline ? "mb-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_330px] md:items-center" : "space-y-3"}>
      <div>
        <label htmlFor={id} className="block text-base font-semibold">默认总结模板</label>
        <p className="mt-1 text-sm leading-6 text-ink-600" id={`${id}-hint`}>
          用于之后生成的总结，已有笔记保持不变。
        </p>
      </div>
      <select
        id={id}
        className="input-shell min-w-0"
        value={selected}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        onChange={(event) => onChange(event.target.value || null)}
      >
        {missing && <option value={selected} disabled>模板已不存在，请重新选择</option>}
        <option value="">{defaults.name} · 内置</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>{trimTemplateText(template.name) || "未命名模板"}</option>
        ))}
      </select>
      {error && <p id={`${id}-error`} className={`text-sm leading-6 text-red-700 ${isInline ? "md:col-span-2" : ""}`}>{error}</p>}
    </div>
  );
}

interface SummaryTemplateSettingsProps {
  templates: SummaryTemplate[];
  defaultId: string | null;
  defaults: SummaryTemplateDefaults;
  editingId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (templates: SummaryTemplate[], defaultId: string | null) => void;
  validation: SummaryTemplateValidation;
}

export default function SummaryTemplateSettings({
  templates, defaultId, defaults, editingId, onSelect, onChange, validation,
}: SummaryTemplateSettingsProps) {
  const [deleteTarget, setDeleteTarget] = useState<SummaryTemplate | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterChangeRef = useRef<"name" | "heading" | null>(null);
  const fieldId = useId();
  const selected = templates.find((template) => template.id === editingId) ?? null;
  const current = selected ?? defaults;
  const errors = selected ? validation.fields.get(selected.id) : undefined;
  const atLimit = templates.length >= defaults.limits.max_templates;

  useEffect(() => {
    if (focusAfterChangeRef.current === "name") {
      nameRef.current?.focus();
      nameRef.current?.select();
    } else if (focusAfterChangeRef.current === "heading") headingRef.current?.focus();
    focusAfterChangeRef.current = null;
  }, [editingId]);

  const changeDefault = useCallback((id: string | null) => onChange(templates, id), [onChange, templates]);
  const create = useCallback((copy = false) => {
    if (atLimit) return;
    const template = newSummaryTemplate(templates, copy ? `${defaults.name} 副本` : "新模板", defaults.content);
    focusAfterChangeRef.current = "name";
    onChange([...templates, template], defaultId);
    onSelect(template.id);
  }, [atLimit, defaultId, defaults, onChange, onSelect, templates]);
  const update = useCallback((field: "name" | "content", value: string) => {
    if (!selected) return;
    onChange(templates.map((template) => template.id === selected.id ? { ...template, [field]: value } : template), defaultId);
  }, [defaultId, onChange, selected, templates]);
  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    onChange(templates.filter((template) => template.id !== deleteTarget.id),
      defaultId === deleteTarget.id ? null : defaultId);
    focusAfterChangeRef.current = "heading";
    onSelect(null);
    setDeleteTarget(null);
  }, [defaultId, deleteTarget, onChange, onSelect, templates]);
  const cancelDelete = useCallback(() => setDeleteTarget(null), []);
  const items = [{ id: null, name: defaults.name, content: "内容概述 · 要点 · 金句 · 详细笔记" }, ...templates];

  return (
    <div className="motion-safe:animate-[content-appear_160ms_ease-out]">
      <SummaryTemplateSelect templates={templates} value={defaultId} defaults={defaults} onChange={changeDefault} error={validation.selectionError} isInline />
      {!validation.valid && (
        <p id="summary-template-validation" role="alert" className="mb-4 text-sm leading-6 text-red-700">{validation.message}</p>
      )}
      <div className="panel grid min-w-0 overflow-hidden md:grid-cols-[254px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-ink-100 bg-[#f7faf5] p-4 md:border-b-0 md:border-r">
          <div className="mb-4 hidden items-center justify-between px-2 py-2 md:flex">
            <h2 className="text-sm font-semibold">模板库</h2>
            <span className="text-xs text-ink-600">{templates.length + 1} 个模板</span>
          </div>
          <div className="mb-4 flex items-center justify-between gap-2 md:hidden">
            <label htmlFor={`${fieldId}-editing`} className="text-sm font-semibold">正在编辑</label>
            <button type="button" className="button-tertiary !px-2 !text-primary-700" disabled={atLimit} onClick={() => create()}>
              <Plus size={16} aria-hidden="true" />新建模板
            </button>
          </div>
          <select
            id={`${fieldId}-editing`}
            className="input-shell md:hidden"
            value={selected?.id ?? ""}
            onChange={(event) => onSelect(event.target.value || null)}
          >
            {items.map((template) => <option key={template.id ?? ""} value={template.id ?? ""}>{trimTemplateText(template.name) || "未命名模板"}{template.id === null ? " · 内置" : ""}</option>)}
          </select>
          <div aria-label="模板列表" className="hidden max-h-[480px] space-y-2 overflow-y-auto p-0.5 md:block">
            {items.map((template) => (
              <button
                type="button"
                key={template.id ?? ""}
                data-template-id={template.id ?? ""}
                aria-label={`编辑模板 ${trimTemplateText(template.name) || "未命名模板"}`}
                aria-pressed={(selected?.id ?? null) === template.id}
                title={template.name}
                onClick={() => onSelect(template.id)}
                className={`block w-full rounded-lg border px-3 py-3 text-left transition-colors ${(selected?.id ?? null) === template.id ? "border-primary-200 bg-primary-50" : "border-transparent hover:bg-canvas-100"}`}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <strong className="min-w-0 truncate text-sm font-semibold">{trimTemplateText(template.name) || "未命名模板"}</strong>
                  {defaultId === template.id && <span className="shrink-0 rounded bg-[#e5efd3] px-1.5 py-0.5 text-xs text-primary-700">默认</span>}
                </span>
                <span className="mt-1 block truncate text-sm leading-6 text-ink-600">{template.content.replace(/[#*`>_]/g, "").replace(/\s+/g, " ")}</span>
                {template.id === null && <span className="mt-1 inline-flex items-center gap-1 rounded bg-canvas-100 px-1.5 text-xs leading-5 text-ink-600"><LockKeyhole size={12} aria-hidden="true" />内置</span>}
                {template.id !== null && validation.fields.has(template.id) && <span className="text-xs text-red-700">需修改</span>}
              </button>
            ))}
          </div>
          <button type="button" disabled={atLimit} onClick={() => create()} className="button-secondary mt-5 hidden w-full md:inline-flex">
            <Plus size={16} aria-hidden="true" />新建模板
          </button>
          <p className="mt-2 text-sm leading-6 text-ink-600 md:mt-5 md:px-2">切换编辑对象，<span className="whitespace-nowrap">不会改变默认模板。</span></p>
          {atLimit && <p className="mt-2 text-sm leading-6 text-ink-600">已达到 {defaults.limits.max_templates} 个自定义模板上限。</p>}
        </aside>
        <section key={selected ? `custom:${selected.id}` : "builtin"} className="min-w-0 p-4 motion-safe:animate-[content-appear_140ms_ease-out] sm:p-7" aria-label="模板编辑器">
          <div className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none sm:text-2xl">{selected ? "编辑模板" : "内置模板"}</h2>
              <span className="rounded bg-canvas-100 px-2 py-1 text-xs text-ink-600">{selected ? "自定义" : "只读"}</span>
            </div>
            {selected ? (
              <button type="button" aria-label="删除模板" className="button-tertiary !text-red-700" onClick={() => setDeleteTarget(selected)}>
                <Trash2 size={16} aria-hidden="true" /><span className="hidden sm:inline">删除模板</span>
              </button>
            ) : (
              <button type="button" className="button-secondary !px-3" disabled={atLimit} onClick={() => create(true)}><Copy size={16} aria-hidden="true" />创建副本</button>
            )}
          </div>
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor={`${fieldId}-name`} className="text-sm font-semibold">模板名称</label>
              <span className="text-xs tabular-nums text-ink-600">{templateCharCount(current.name)} / {defaults.limits.max_name_chars}</span>
            </div>
            <input
              ref={nameRef} id={`${fieldId}-name`} className="input-shell scroll-mt-40 read-only:bg-canvas-50"
              value={current.name} readOnly={!selected} autoComplete="off"
              aria-invalid={Boolean(errors?.name)} aria-describedby={errors?.name ? `${fieldId}-name-error` : undefined}
              onChange={(event) => update("name", event.target.value)}
            />
            {errors?.name && <p id={`${fieldId}-name-error`} className="mt-2 text-sm text-red-700">{errors.name}</p>}
          </div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor={`${fieldId}-content`} className="text-sm font-semibold">总结要求</label>
            <span className="text-xs text-ink-600">支持 Markdown</span>
          </div>
          <textarea
            id={`${fieldId}-content`} value={current.content} readOnly={!selected}
            className="textarea-shell min-h-[280px] scroll-mt-40 resize-y !text-base read-only:bg-canvas-50 sm:min-h-[320px]"
            rows={10} spellCheck={false} aria-invalid={Boolean(errors?.content)}
            aria-describedby={`${fieldId}-hint${errors?.content ? ` ${fieldId}-content-error` : ""}`}
            onChange={(event) => update("content", event.target.value)}
          />
          {errors?.content && <p id={`${fieldId}-content-error`} className="mt-2 text-sm text-red-700">{errors.content}</p>}
          <div className="mt-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-sm leading-6 text-ink-600">
            <p id={`${fieldId}-hint`}>视频标题和转录会自动带入，无需填写占位符。</p>
            <span className="ml-auto shrink-0 text-xs tabular-nums">{templateCharCount(current.content)} / {defaults.limits.max_content_chars.toLocaleString()}</span>
          </div>
        </section>
      </div>
      <ConfirmModal
        open={deleteTarget !== null} title="删除总结模板" confirmText="确认删除"
        message={deleteTarget?.id === defaultId
          ? `删除「${deleteTarget?.name}」后，默认模板将回到「${defaults.name}」。保存设置后生效，不影响已有笔记或已开始的任务。`
          : `确定删除「${deleteTarget?.name ?? ""}」吗？保存设置后生效，已有笔记保持不变。`}
        onConfirm={confirmDelete} onCancel={cancelDelete}
      />
    </div>
  );
}

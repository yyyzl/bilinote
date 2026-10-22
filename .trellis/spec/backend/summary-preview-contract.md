# 总结与预览契约

## 入口和数据流

`llm.rs::build_summary_prompt_with_template(title, transcript, template: Option<&str>) -> String` is the shared API/Codex entry for streaming and non-streaming summaries. It requests Markdown summary and an approximately 30–50 Chinese-character preview in one response; preview never adds a second request. Transcription switches, cancellation and independent mindmap generation retain their existing behavior.

`None` delegates to the original `build_summary_prompt` without changing its output. The built-in body remains based on `c37425a`: all four sections, their order/icons, quote-extraction rules, six requirements and transcription-quality warning are preserved. JSON/preview requirements are appended after that original text. The frozen historical fixture still checks the complete original instructions. Custom instructions replace only the body-format branch; they do not replace the application's source-grounding or output protocol.

生成的最终文本经过 `summary_output.rs::parse_summary_output(raw: &str) -> Result<SummaryOutput>`。结构：

```json
{"summary":"## 核心要点\n实际内容。","preview":"可区分当前笔记的具体内容或结论。"}
```

`commands.rs` 三个落盘入口：

| Invoke / 内部入口 | 解析和写入 |
|---|---|
| `summarize(note_id)` | 同步生成完成后解析，字段级更新 summary / preview |
| `start_summarize(note_id)` → `summarize_background` | 流式收集完成后解析，字段级更新 summary / preview |
| `start_transcribe(bvid, source_url)` → `transcribe_background` | 自动总结与导图并行；总结解析成功后一起合并 summary / preview，不覆盖转录 |

`store.rs::Note.preview` 为 `#[serde(default)] Option<String>`。旧 JSON 缺失字段时为 None，无迁移、无批量重写。前端 `lib/tauri.ts::Note.preview` 为 `string | null`，通过 `get_notes` / `get_note` 返回。

## Custom Templates and Task Ownership

- Persisted `AppConfig.summary_templates` and `default_summary_template_id` follow [the storage contract](./database-guidelines.md). Null/missing selects the immutable built-in template; a dangling ID is an error, never a silent fallback.
- `SummaryTemplateSnapshot::capture` validates the library and owns either the selected instruction string, built-in selection, or a sanitized `AppError::StoreError`. It holds no configuration reference, account credentials or mutable global cache.
- `start_summarize` and `start_transcribe` capture the template **before publishing TaskInfo::queued**, and move it through their queue/background boundaries. Workers attach that snapshot to the later-created `GenerationClient`; ASR/account/provider/model settings retain their previous read timing. Synchronous `summarize` captures through `GenerationClient::from_config` when its configuration is loaded.
- Editing, deleting or switching the global template cannot affect an accepted task, including its internal API retries. Starting a new task, including a user-initiated retry that enqueues a new task, captures current settings. Codex still does not use API-style automatic retries.
- Template validation failures are checked by summary methods before an API request or Codex generation process. They do not disable an independent mindmap with otherwise valid provider settings. Automatic-generation partial-failure handling, saved transcription, field-level note updates and existing summary/preview parsing stay unchanged.
- Custom instruction whitespace and braces are literal. There is no placeholder engine: `{title}`, `{transcript}`, JSON braces and Markdown are not expanded. The application separately supplies actual title/transcript, source-grounding and incomplete-transcription warnings, JSON escaping/packaging, and preview length/content rules.

## Built-in Metadata Invoke

`get_summary_template_defaults()` performs no generation or configuration write. Its serializable response is:

```json
{
  "name": "标准笔记",
  "content": "<the original four-section body instructions, without injected title/transcript>",
  "limits": {
    "max_templates": 50,
    "max_id_bytes": 64,
    "max_name_chars": 80,
    "max_content_chars": 12000
  }
}
```

The UI must obtain read-only built-in display/copy text and limits from this command, not copy the illustrative prototype text or hard-code another prompt. The metadata content is a verbatim part of the historical built-in prompt; it is not the complete source/output envelope. Name/content limits count Unicode scalar values, not JavaScript UTF-16 units. UI selection of the built-in maps to `null`, not a persisted custom entry.

## 校验与错误矩阵

| 情况 | 结果 |
|---|---|
| 有效 JSON，summary 非空，preview 为字符串 | 分离保存；预览压平空白但不截断 |
| JSON 外层有 `json` 代码围栏 | 去围栏后正常解析 |
| 纯 Markdown | 正文保留，preview 为 None，前端使用转录摘录 |
| preview 缺失、null、空白、非字符串 | 不丢失有效总结，preview 为 None |
| 空返回、坏 JSON、summary 缺失/非字符串/空白 | 返回固定 LlmError；手动生成不覆盖原有产物；自动生成保留已落盘转录并报告部分失败 |
| 模型请求失败或取消 | 沿用后台错误/取消路径，不发第二次预览请求 |

Good：正确对象同时产生两字段；Base：旧笔记和 Markdown 返回仍可阅读；Bad：只有 preview 或截断对象不能覆盖已有总结。

## Template Regression Coverage

`generation.rs` includes `summary_template_generation_tests.rs`. Tests use a loopback HTTP server and a std-only fake Codex executable compiled from `testdata/codex_summary_fixture.rs` into an isolated temporary directory. They cover provider/mode prompt parity, exact built-in preservation, literal custom text, metadata, invalid-selection rejection before requests, unchanged mindmaps, owned snapshots across queue/edit/delete/retry, cancellation before generation and no Codex automatic retry. No real model/account requests are needed.

The two native command acceptance boundaries have a **source-level guard**, complemented by executable semaphore/snapshot tests; this is not native Tauri invoke or automatic-pipeline end-to-end coverage. Review partial-failure/field-level persistence wiring separately and keep native platform checks explicit. If the npm unit runner's 60-second cap is exhausted during compilation, run `cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` first; a compilation timeout is not behavioral RED.

## 界面与测试

`src/lib/note-preview.ts::getNotePreview(note)` 只取有效 preview 或可读 transcript，清理摘录中的标题、常见时间戳与 Markdown 标记，单行省略由 CSS 实现。日期弱化，总结/导图徽标保留；不使用封面和按笔记生成的图标。

`npm run test:unit` 在 60 秒进程上限内覆盖 JSON/围栏、长中文、缺省、错误类型、坏输出及旧 Note 反序列化/preview 序列化往返。`npm run test:ui` 使用离线桥接验证真实 React 的预览回退、搜索、任务恢复和设置；必须先启动 Vite，不调用真实服务。

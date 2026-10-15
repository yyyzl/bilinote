# 总结与预览契约

## 入口和数据流

`llm.rs::build_summary_prompt(title, transcript) -> String` 同时要求 Markdown 总结与约 30–50 个汉字的具体内容预览。`GenerationClient` 的 API 和 Codex 路由共用它，不为预览新增请求。原有转录、总结、导图开关与取消机制保持有效。

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

## 界面与测试

`src/lib/note-preview.ts::getNotePreview(note)` 只取有效 preview 或可读 transcript，清理摘录中的标题、常见时间戳与 Markdown 标记，单行省略由 CSS 实现。日期弱化，总结/导图徽标保留；不使用封面和按笔记生成的图标。

`npm run test:unit` 在 60 秒进程上限内覆盖 JSON/围栏、长中文、缺省、错误类型、坏输出及旧 Note 反序列化/preview 序列化往返。`npm run test:ui` 使用离线桥接验证真实 React 的预览回退、搜索、任务恢复和设置；必须先启动 Vite，不调用真实服务。

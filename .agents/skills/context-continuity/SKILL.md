---
name: context-continuity
description: "指导 agent 何时以及如何更新任务的 .fusion/ 执行态文件"
---

# Context Continuity Skill

## 何时写 Checkpoint

以下时机应更新 `.fusion/` 状态:

| 时机 | 触发方式 | 写入内容 |
|------|----------|----------|
| `brainstorm-plus` 结束后 | 手动或 Skill 提醒 | 设计决策 |
| `write-task-plan` 结束后 | 手动或 Skill 提醒 | 计划结构 + 可选 contract.md |
| `execute-plan-tdd` 每完成一个 Slice | 自动 | plan_progress + validation |
| `systematic-debugging` 定位根因后 | 手动 | 诊断结论 + decisions |
| `review-with-agents` 审查完成后 | 手动 | 审查结论 |
| Compact 完成后 (收到提醒) | 半自动 | 全量状态刷新 |
| 上下文使用率达 ~60% 时 | 主动 | 预防性保存 |

## 主动 Checkpoint 策略

不要只依赖 PreCompact hook（那是事后提醒）。Agent 应在以下情况**主动**执行 checkpoint:
- 上下文使用率接近 60%（远早于 80% 自动 compact 阈值）
- 完成一个重要的技术决策
- 遇到需要记录的 blocker
- 准备切换到另一个子任务

## recovery.json 更新规则

- 只更新变化的字段，不重写全部
- `updated_at` 每次更新
- `source` 标识触发更新的 Skill/命令
- `decisions` 只追加不删除
- **并发写入**：只有主 agent (Claude) 写 recovery.json，Codex/Gemini 只读

## handoff.md 更新规则

- 每次 checkpoint 默认同时更新
- 每次完全重写（不是追加）
- 保持 6 段固定结构，控制在 200 行以内

## 命令参考

### 保存状态
```bash
python3 .trellis/scripts/fusion/checkpoint.py \
  --slice <当前slice> \
  --status "<当前步骤描述>" \
  --files "<正在编辑的文件>" \
  --source "<当前skill名>" \
  --next "<下一步建议>"
```

### 恢复状态
```bash
python3 .trellis/scripts/fusion/resume.py [--full]
```

### 或使用命令
- `/fusion:checkpoint` — 手动保存进度
- `/fusion:resume-context` — 语义恢复

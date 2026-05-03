# Trellis 融合工作流速查表（默认开 Hook）

> 适用对象：当前仓库中的 **Codex** 与 **Claude Code**  
> 默认前提：两边都已启用当前仓库自带的 hook 配置  
> 目的：快速回答“新会话进来以后，我到底该怎么走”

---

## 1. 一句话总览

开 hook 以后：

- **会话开场上下文** 通常由 hook 自动注入
- **复杂任务的计划链路** 仍然需要你显式推进
- **收尾链路** 仍然需要你显式推进

所以现在的核心不是：

```text
每次都先手工 start
```

而是：

```text
新会话启动时，hook 先帮你把 start 的开场上下文做掉；
然后你根据任务复杂度，决定走快路径还是四件套。
```

---

## 2. Codex 默认开 Hook

> **前提条件**：Codex hook 是实验性功能，需要你的 Codex CLI 版本支持并已全局启用 hook 能力。
> 如果 hook 未启用，`SessionStart` 自动注入不会生效，你需要每次手工跑 `$start`。
> 四件套本身不受影响（它们是手工调用的）。

### 2.1 Hook 自动做了什么

当前 Codex hook 只接了 `SessionStart`：

- 自动注入当前 task 状态
- 自动注入 `.trellis/workflow.md`
- 自动注入 `.trellis/spec/` 的 index
- 自动注入 `start` skill 的说明

等价理解：

```text
新开会话时，hook ≈ 隐式执行了 $start 的开场部分
```

### 2.2 Hook 没做什么

Codex hook **不会**自动替你跑：

- `$brainstorm-plus`
- `$write-task-plan`
- `$execute-plan-tdd`
- `$harvest-learnings`
- `$check`
- `$finish-work`
- `$record-session`

---

### 2.3 Codex 复杂任务速查表

```text
新开会话（hook 已自动注入上下文）
→ 直接说需求
→ $brainstorm-plus
→ $write-task-plan
→ $execute-plan-tdd
→ $harvest-learnings
→ $check
→ $finish-work
→ 人工测试并 git commit
→ $record-session
```

适用：

- 新功能
- 重构
- 多文件改动
- 跨层改动
- 需要 TDD 和计划化执行

---

### 2.4 Codex 简单任务速查表

```text
新开会话（hook 已自动注入上下文）
→ 直接说需求
→ 默认 Trellis 快路径直接实现
→ $check
→ $finish-work
→ 人工测试并 git commit
→ $record-session
```

如果这次简单改动产出了长期有效经验，再补：

```text
→ $harvest-learnings
```

---

### 2.5 Codex 什么时候还手工跑 `$start`

推荐手工跑 `$start` 的场景：

- 你想重新拉一遍上下文
- 当前会话已经跑偏
- 中途切换任务
- 你怀疑 hook 注入的信息不够

所以现在对 Codex 的理解是：

- **新会话开始**：通常不必先手工 `$start`
- **需要重新对齐上下文**：随时可以手工 `$start`

---

## 3. Claude Code 默认开 Hook

### 3.1 Hook 自动做了什么

当前 Claude Code 已配置：

- `SessionStart`
- `PreCompact`
- `PreToolUse`
- `SubagentStop`

这意味着：

#### SessionStart 自动做的事

- 注入当前状态
- 注入 `.trellis/workflow.md`
- 注入 `.trellis/spec/` index
- 注入 `/trellis:start` 的说明
- **注入 `.fusion/` 恢复数据**（handoff 摘要 + recovery 进度 + contract）

等价理解：

```text
新开 Claude 会话时，hook ≈ 隐式执行了 /trellis:start 的开场部分 + context-continuity 恢复
```

#### PreCompact 自动做的事

- Compact 完成后注入 `<fusion-post-compact-guide>` 提醒
- 提醒 agent 读取/更新 `.fusion/recovery.json` 和 `handoff.md`

#### PreToolUse 自动做的事

- 在 Agent / Task 调用前自动注入 JSONL 上下文

#### SubagentStop 自动做的事

- `check` agent 停止时触发 Ralph Loop 验证

所以 Claude 的 hook 能力明显比 Codex 更强。

---

### 3.2 Claude 复杂任务速查表

```text
新开会话（hook 已自动注入上下文）
→ 直接说需求
→ /fusion:brainstorm-plus
→ /fusion:write-task-plan
→ /fusion:execute-plan-tdd（默认 1 个 slice / 次）
→ /fusion:harvest-learnings
→ /trellis:check
→ /trellis:finish-work
→ 人工测试并 git commit
→ /trellis:record-session
```

适用：

- 新功能
- 重构
- 多文件改动
- 跨层改动
- 需要更强设计确认
- 需要按 TDD 执行

---

### 3.3 Claude 简单任务速查表

```text
新开会话（hook 已自动注入上下文）
→ 直接说需求
→ 默认 Trellis 快路径直接实现
→ /trellis:check
→ /trellis:finish-work
→ 人工测试并 git commit
→ /trellis:record-session
```

如果这次简单改动有可复用经验，再补：

```text
→ /fusion:harvest-learnings
```

---

### 3.4 Claude 什么时候还手工跑 `/trellis:start`

推荐手工跑 `/trellis:start` 的场景：

- 你想强制重新整理上下文
- 当前对话已经偏了
- 中途切任务
- 你要显式地让 Claude 回到 Trellis 主流程

所以现在对 Claude 的理解是：

- **新会话开始**：通常不必先手工 `/trellis:start`
- **要重置流程感知**：随时可以手工 `/trellis:start`

---

## 4. 两边最推荐的默认心智模型

### 4.1 复杂任务

```text
hook 自动开场
→ 说需求
→ 脑暴
→ 写计划
→ 按计划 TDD 执行
→ 收割经验
→ 检查
→ 收尾
→ 提交后记录 session
```

### 4.2 简单任务

```text
hook 自动开场
→ 说需求
→ 直接实现
→ 检查
→ 收尾
→ 提交后记录 session
```

---

## 5. 辅助能力速查

### 遇到 bug 时

```text
/fusion:systematic-debugging
```

四阶段：根本原因 → 模式分析 → 假设测试 → TDD 修复。
3 次修不好 → 停下来讨论架构。

### 高风险任务想加审查时

```text
execute-plan-tdd 按 1 个 slice / 次推进
全部 slice 完成后 → /fusion:review-with-agents → harvest-learnings
```

调度两个独立子代理：规范审查 + 质量审查。
不通过 → 修 → 重审。可选，简单任务不需要。

### 手动保存/恢复执行状态

```text
保存：/fusion:checkpoint
恢复：/fusion:resume-context
```

- checkpoint 保存当前 slice 进度、工作文件、决策、阻塞到 `.fusion/`
- resume-context 读取 `.fusion/` 恢复数据并输出恢复摘要
- 新会话时 SessionStart hook 会自动注入 `.fusion/` 摘要，通常不需要手动 resume
- 建议在上下文接近 60% 时主动 checkpoint

### 安装 Fusion 到其他项目

```bash
./install-fusion.sh /path/to/target/project
```

---

## 6. 最短决策规则

如果你只记一句：

### Codex

```text
开 hook 后，新会话一般不用先敲 $start；
复杂任务走四件套，简单任务走快路径。
```

### Claude Code

```text
开 hook 后，新会话一般不用先敲 /trellis:start；
复杂任务走四件套，简单任务走快路径。
```

---

## 7. 相关文档

- [融合工作流完整说明](./fusion-workflow.md)
- [README 中文版](../README_CN.md)

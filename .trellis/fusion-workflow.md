# Trellis 融合工作流使用说明

> 适用范围：当前仓库里的 **Claude Code** 与 **Codex** 双平台工作流扩展  
> 版本基线：`@mindfoldhq/trellis 0.4.0-beta.8`  
> 更新时间：`2026-03-26`

快速入口：

- [默认开 Hook 的速查表](./fusion-workflow-quickref.md)
- [自定义 Trellis 维护与安装说明](./custom-trellis-maintenance.md)

---

## 1. 这份文档解决什么问题

这份文档说明当前仓库在原始 Trellis 工作流之外，新增的 7 个 Fusion 能力应该怎么用：

**四件套（计划优先链路）：**

- `brainstorm-plus`
- `write-task-plan`
- `execute-plan-tdd`
- `harvest-learnings`

**辅助能力：**

- `systematic-debugging` — 四阶段系统化调试
- `review-with-agents` — 子代理交叉审查
- `context-continuity` — 上下文恢复与执行态持久化

它主要回答两个问题：

1. **Codex 现在推荐怎么走？**
2. **Claude Code 现在推荐怎么走？**

---

## 2. 先说结论

### 2.1 Codex 现在的推荐工作流

> 如果你在 Codex 里开启了 **实验性 hook**，请先看 [2.1.1](#211-codex-开启实验性-hook-以后会发生什么)。

#### 复杂需求 / 新功能 / 重构 / 跨层改动

```text
$start
→ 说需求
→ $brainstorm-plus
→ $write-task-plan
→ $execute-plan-tdd
→ $harvest-learnings
→ $check
→ $finish-work
→ 人工测试并 git commit
→ $record-session
```

#### 简单需求 / 小修复 / 明确改动

```text
$start
→ 说需求
→ 按默认 Trellis 流程直接实现
→ $check
→ $finish-work
→ 人工测试并 git commit
→ $record-session
```

如果这个简单改动里沉淀出了值得长期复用的规则，可以在 `check` 之前补一步：

```text
→ $harvest-learnings
```

### 2.1.1 Codex 开启实验性 hook 以后会发生什么

当前仓库里的 Codex hook 配置只接了 **`SessionStart`**：

- [`.codex/hooks.json`](../.codex/hooks.json)
- [`.codex/hooks/session-start.py`](../.codex/hooks/session-start.py)

这意味着：

1. **新开会话时**，Codex 会自动注入：
   - 当前 task 状态
   - `.trellis/workflow.md`
   - `.trellis/spec/` 的 index
   - `start` skill 的说明

2. 它本质上相当于把 **`$start` 的“起步上下文恢复”部分自动做了**

3. 但它**没有**自动接管：
   - `$brainstorm-plus`
   - `$write-task-plan`
   - `$execute-plan-tdd`
   - `$harvest-learnings`
   - `$check`
   - `$finish-work`
   - `$record-session`

所以答案是：

**不是“完全像原来那样”，但也不是“整条流程自动升级了”。**

更准确地说：

- **变化的是开场**
- **不变的是中后段仍然要按你的工作流显式推进**

#### 开了 hook 以后，Codex 的复杂任务推荐流

```text
新开会话（hook 自动注入上下文，相当于隐式 $start）
→ 说需求
→ $brainstorm-plus
→ $write-task-plan
→ $execute-plan-tdd
→ $harvest-learnings
→ $check
→ $finish-work
→ 人工测试并 git commit
→ $record-session
```

#### 开了 hook 以后，Codex 的简单任务推荐流

```text
新开会话（hook 自动注入上下文）
→ 说需求
→ 默认 Trellis 快路径直接实现
→ $check
→ $finish-work
→ 人工测试并 git commit
→ $record-session
```

#### 那 `$start` 还要不要手工跑？

可以这样理解：

- **新会话刚开始**：通常可以不手工跑 `$start`
- **你想重新拉一遍上下文**、**当前会话已经跑偏**、**中途切任务**：仍然可以手工跑 `$start`

也就是说，开了 hook 以后：

- `$start` 从“每次都要手工敲的入口”
- 变成“多数时候由 hook 隐式替代，但仍可手工重置上下文的入口”

---

### 2.2 Claude Code 现在的推荐工作流

#### 复杂需求 / 新功能 / 重构 / 跨层改动

```text
/trellis:start
→ 说需求
→ /fusion:brainstorm-plus
→ /fusion:write-task-plan
→ /fusion:execute-plan-tdd
→ /fusion:harvest-learnings
→ /trellis:check
→ /trellis:finish-work
→ 人工测试并 git commit
→ /trellis:record-session
```

#### 简单需求 / 小修复 / 明确改动

```text
/trellis:start
→ 说需求
→ 按默认 Trellis 流程直接实现
→ /trellis:check
→ /trellis:finish-work
→ 人工测试并 git commit
→ /trellis:record-session
```

如果简单改动里有高价值经验，也可以补：

```text
→ /fusion:harvest-learnings
```

---

## 3. 旧流程与新流程怎么对应

### 3.1 Codex：从旧习惯到当前推荐

你之前记忆里的 Codex 流程是：

```text
$start
→ 说需求
→ $before-frontend-dev 或 $before-backend-dev
→ 实现
→ $check-frontend 或 $check-backend
→ $finish-work
→ git提交
→ $record-session
```

但在当前仓库版本 `0.4.0-beta.8` 里，Trellis 已经把这两个入口统一了：

- `$before-frontend-dev` / `$before-backend-dev` → **统一为** `$before-dev`
- `$check-frontend` / `$check-backend` → **统一为** `$check`

所以**当前 Trellis 原生基线**更准确地说，是：

```text
$start
→ 说需求
→ $before-dev
→ 实现
→ $check
→ $finish-work
→ 人工测试并 git commit
→ $record-session
```

而**当前仓库新增后的“计划优先”推荐流**，是在这条基线上插入 4 个更强的步骤：

```text
$start
→ 说需求
→ $brainstorm-plus
→ $write-task-plan
→ $execute-plan-tdd
→ $harvest-learnings
→ $check
→ $finish-work
→ 人工测试并 git commit
→ $record-session
```

---

### 3.2 Claude Code：从轻量流到计划优先流

你之前描述的 Claude Code 使用习惯比较轻量：

```text
/trellis:start
→ 说需求
→ /trellis:record-session
```

这条路径并不是错，而是**更像“让 `/trellis:start` 自己接管大部分流程”** 的用法。

现在新增四件套之后，Claude Code 的推荐方式改成：

```text
/trellis:start
→ 说需求
→ /fusion:brainstorm-plus
→ /fusion:write-task-plan
→ /fusion:execute-plan-tdd
→ /fusion:harvest-learnings
→ /trellis:check
→ /trellis:finish-work
→ 人工测试并 git commit
→ /trellis:record-session
```

也就是说：

- `/trellis:start` 仍然是入口
- 但复杂任务不再只靠 `/trellis:start` 自动推进
- 而是显式进入“脑暴 → 计划 → TDD 执行 → 经验沉淀”的链路

---

## 4. 四个新增能力各自负责什么

### 4.1 `brainstorm-plus`

作用：

- 比原始 `brainstorm` 更强调设计确认
- 产出稳定的需求和设计文档

落地文件：

- `.trellis/tasks/<task>/prd.md`
- `.trellis/tasks/<task>/info.md`

适合场景：

- 需求不够清楚
- 有多个方案要权衡
- 你想保留类似 Superpowers 的脑暴体验

---

### 4.2 `write-task-plan`

作用：

- 根据 `prd.md + info.md + spec + 代码模式` 生成任务内执行计划
- 强制用 **TDD-first** 的方式拆执行切片

落地文件：

- `.trellis/tasks/<task>/plan.md`

适合场景：

- 已经知道要做什么
- 但不想直接进入编码
- 希望先把执行切片拆清楚

---

### 4.3 `execute-plan-tdd`

作用：

- 读取 `plan.md`
- 一段一段按 **Red → Green → Refactor** 执行
- 不是再做需求，也不是再做计划，而是严格执行
- **默认每次只执行 1 个 slice**
- 达到本次 slice budget 后先停下来汇报，再继续下一次执行
- 只有用户明确要求时，才把单次预算提高到 2 个以上 slice

适合场景：

- 计划已经写好
- 你想把 TDD 变成默认执行方式

---

### 4.4 `harvest-learnings`

作用：

- 从当前 task、改动、测试、验证过程里提炼“长期有效经验”
- 自动沉淀回 `.trellis/spec/`
- 过滤一次性任务噪声

适合场景：

- 本次任务里有值得复用的规则
- 你修了一个以后还会再踩的坑
- 你发现了一个值得团队复用的新模式

---

### 4.5 `systematic-debugging`

作用：

- 四阶段系统化调试：根本原因调查 → 模式分析 → 假设测试 → TDD 修复
- 3 次修复失败自动升级为架构问题讨论

适合场景：

- 遇到任何 bug、测试失败、意外行为
- 尤其是已经尝试过一次修复但没成功时
- 时间紧迫时（系统化比乱试更快）

不适合场景：

- AI 陷入重复循环 → 用 `break-loop`

---

### 4.6 `review-with-agents`

作用：

- 调度独立子代理对实现进行两阶段交叉审查
- 第一阶段：规范审查（代码是否符合 PRD）
- 第二阶段：质量审查（代码是否写得好）
- 审查不通过 → 修复 → 重审循环

适合场景：

- 复杂任务（3+ 文件改动、跨层、新架构）
- 高风险变更（认证、支付、数据迁移）
- 你对实现质量不够放心

可选：简单任务不需要，`check` + `finish-work` 已经够用。

---

### 4.7 `context-continuity`

作用：

- 在任务目录下维护 `.fusion/` 执行态文件
- 新会话时自动注入恢复摘要（SessionStart hook）
- Compact 后提醒 agent 检查/更新状态（PreCompact hook）
- 提供手动 checkpoint / resume 命令

落地文件：

- `.trellis/tasks/<task>/.fusion/recovery.json` — 机器可读的执行态
- `.trellis/tasks/<task>/.fusion/handoff.md` — 人/AI 可读的交接摘要
- `.trellis/tasks/<task>/.fusion/events.jsonl` — 审计事件流
- `.trellis/tasks/<task>/.fusion/contract.md` — Sprint Contract（可选）

命令：

| 作用 | Codex | Claude Code |
| --- | --- | --- |
| 保存执行状态 | 手动调 `checkpoint.py` | `/fusion:checkpoint` |
| 语义恢复 | 手动调 `resume.py` | `/fusion:resume-context` |

适合场景：

- 复杂任务，会话可能中断
- 跨平台协作（Claude Code ↔ Codex）
- 任务时间跨度较长

---

## 5. 推荐的分层理解

为了避免工作流冲突，建议你一直用下面这套分层理解：

- `prd.md`
  只管 **做什么 / 为什么做 / 验收标准**

- `info.md`
  只管 **设计 / 架构 / 边界 / 风险**

- `plan.md`
  只管 **怎么执行**

- `.trellis/spec/`
  只管 **以后还会复用的规则**

- `workspace journal`
  只管 **这次 session 发生了什么**

这样就不会把：

- 需求
- 设计
- 计划
- 经验沉淀
- 会话记录

混在同一个层里。

---

## 6. 按任务类型怎么选流程

### 6.1 复杂任务

满足任意一条，就推荐走四件套：

- 需求还不清楚
- 需要多轮设计确认
- 涉及多个文件或多个层
- 你想严格执行 TDD
- 你希望把经验稳定沉淀回 spec

推荐：

```text
start → brainstorm-plus → write-task-plan → execute-plan-tdd → harvest-learnings
```

如果是高风险任务（认证、支付、数据迁移），在 execute-plan-tdd 之后加一步：

```text
execute-plan-tdd → review-with-agents → harvest-learnings
```

如果实现过程中遇到 bug：

```text
→ systematic-debugging → 修复后继续 execute-plan-tdd
```

---

### 6.2 中等任务

如果需求已经比较清楚，但你仍然想保留 TDD 与计划化执行：

```text
start
→ 说需求
→ 视情况直接进入 write-task-plan
→ execute-plan-tdd
→ harvest-learnings
→ check
→ finish-work
→ record-session
```

前提是当前 task 已经有足够稳定的 `prd.md / info.md`。

---

### 6.3 简单任务

比如：

- 文案修正
- 单点 bugfix
- 很小的配置修改
- 不值得专门写计划的改动

推荐：

```text
start
→ 说需求
→ 默认 Trellis 流程直接实现
→ check
→ finish-work
→ record-session
```

如果中途发现这次修复其实暴露了长期问题，再补：

```text
→ harvest-learnings
```

---

## 7. Codex 与 Claude Code 的命令对照

### 7.1 新增命令 / 技能

| 作用 | Codex | Claude Code |
| --- | --- | --- |
| 深度脑暴 | `$brainstorm-plus` | `/fusion:brainstorm-plus` |
| 生成任务计划 | `$write-task-plan` | `/fusion:write-task-plan` |
| 按 TDD 执行计划（默认 1 个 slice / 次） | `$execute-plan-tdd` | `/fusion:execute-plan-tdd` |
| 收割经验沉淀到 spec | `$harvest-learnings` | `/fusion:harvest-learnings` |
| 系统化调试 | `$systematic-debugging` | `/fusion:systematic-debugging` |
| 子代理交叉审查 | `$review-with-agents` | `/fusion:review-with-agents` |
| 保存执行状态 | `python3 .trellis/scripts/fusion/checkpoint.py` | `/fusion:checkpoint` |
| 语义恢复 | `python3 .trellis/scripts/fusion/resume.py` | `/fusion:resume-context` |

### 7.2 仍然保留的原生命令

| 作用 | Codex | Claude Code |
| --- | --- | --- |
| 会话启动 | `$start` | `/trellis:start` |
| 开发前读规范 | `$before-dev` | `/trellis:before-dev` |
| 质量检查 | `$check` | `/trellis:check` |
| 收尾检查 | `$finish-work` | `/trellis:finish-work` |
| 会话记录 | `$record-session` | `/trellis:record-session` |

---

## 8. 常见问题

### 8.1 `$start` / `/trellis:start` 现在还重要吗？

重要。

它仍然是入口，负责：

- 恢复上下文
- 看当前 task
- 看 workspace 和记忆
- 确定当前工作状态

新四件套不是替代 `start`，而是接在 `start` 后面。

对 **Codex + 实验性 hook** 来说，`$start` 的“会话起步”部分通常已经被 hook 隐式执行。
但它仍然可以作为手工重置上下文的入口使用。

---

### 8.2 `$before-dev` / `/trellis:before-dev` 还要不要用？

要。

它负责读规范。  
只是对于复杂任务来说，你现在通常会先用：

```text
start → brainstorm-plus → write-task-plan
```

而不是一上来就手工点 `before-dev`。

在很多情况下，`start` 和后续流程已经会把“先读规范”这件事纳入上下文。

如果你单独切到某个任务开始编码，手工跑一次 `before-dev` 仍然是合理的。

---

### 8.3 `$check` / `/trellis:check` 和 `harvest-learnings` 会冲突吗？

不会。

- `harvest-learnings` 是把经验沉淀回 spec
- `check` 是检查代码是否符合 spec

推荐顺序是：

```text
harvest-learnings → check
```

因为你先把新经验写入 spec，再跑检查，逻辑上更完整。

---

### 8.4 什么时候可以跳过四件套？

可以跳过的典型场景：

- 极小改动
- 纯文案调整
- 你只是继续一个已经快完成的 task
- 已经存在成熟的 `plan.md`

这时可以从更后面的步骤开始，比如直接：

```text
execute-plan-tdd
```

或：

```text
check → finish-work → record-session
```

---

### 8.5 简单任务做到一半发现更复杂了，怎么升级到四件套？

这种情况很常见。判断标准：

- 你发现要改的文件超过 3 个
- 你不确定影响范围
- 你开始犹豫"该不该加个测试"

任何一条命中，就停下来：

```text
1. 把已有的理解写进当前 task 的 prd.md（哪怕只是草稿）
2. 跑 brainstorm-plus，把 prd.md 和 info.md 补完整
3. 跑 write-task-plan，把剩余工作拆成切片
4. 从 execute-plan-tdd 继续，默认先跑 1 个 slice
```

不需要回退已经写好的代码。只要后续切片走 TDD 就可以。

---

### 8.6 四件套中途断开了（会话结束），下次怎么恢复？

Trellis 的 task 目录天然支持跨会话恢复。你只需要看当前 task 里已经存在哪些文件：

| task 目录里已有的文件 | 下次从哪里继续 |
|---------------------|---------------|
| 什么都没有 | 从 `start` 开始 |
| 只有 `prd.md` | 从 `brainstorm-plus` 继续（补完 `info.md`） |
| 有 `prd.md` + `info.md` | 从 `write-task-plan` 开始 |
| 有 `prd.md` + `info.md` + `plan.md` | 从 `execute-plan-tdd` 开始（默认先跑 1 个 slice） |
| 上面都有，代码也写了一部分 | 从 `execute-plan-tdd` 继续未完成的切片（默认仍按 1 个 slice / 次推进） |
| 全部完成 | 从 `harvest-learnings` 开始 |

关键点：

- `start` 会自动恢复当前 task 上下文
- `execute-plan-tdd` 会读 `plan.md` 并识别哪些切片已经完成
- `execute-plan-tdd` 默认每次跑 1 个 slice，跑完先汇报，再继续下一次
- 已完成的切片不需要重做

**增强恢复**：启用 `context-continuity` 后，`.fusion/` 目录会保存更精确的执行态（当前 slice、工作文件、技术决策、阻塞点），新会话时自动注入恢复摘要。详见 [4.7 context-continuity](#47-context-continuity)。

---

### 8.7 什么是 context-continuity？什么时候用？

`context-continuity` 是第 7 个 Fusion 能力，解决的问题是：

> 会话断开后，agent 知道"该做什么"（有 prd/plan），但不知道"做到了哪一步"。

**三级恢复模型**：

| 级别 | 名称 | 来源 | 恢复率 |
|------|------|------|--------|
| Level 1 | Exact Resume | provider 原生会话恢复 | ~100% |
| Level 2 | Semantic Resume | `.fusion/recovery.json` + `handoff.md` | ~85% |
| Level 3 | Cold Resume | `prd.md` + `plan.md` + `info.md` | ~50% |

Level 1 和 Level 3 已有。**Level 2 就是 context-continuity 提供的**。

**使用场景**：
- 新会话开始时，SessionStart hook 自动注入 `.fusion/` 恢复摘要
- Compact 后，PreCompact hook 提醒 agent 检查/更新 `.fusion/` 状态
- 手动保存：`/fusion:checkpoint`
- 手动恢复：`/fusion:resume-context`

**不需要时**：
- 极简任务（无需跨会话持续）
- 会话未断开（Level 1 足够）

---

## 9. 前提条件

### 9.1 Codex 实验性 Hook 前提

当前仓库的 Codex hook（`.codex/hooks.json`）依赖 **Codex 实验性 hook 功能**。

如果你还没有全局启用 Codex hook 能力，需要先执行：

```bash
# 确认 Codex 支持 hook（需要 Codex CLI 版本 >= 0.1.2025xxxx）
codex --version

# 在 Codex 设置中启用实验性 hook
# 具体方式参考 Codex 官方文档
```

**如果 Codex hook 未启用**：

- `SessionStart` 自动注入不会生效
- 你需要每次手工跑 `$start` 来恢复上下文
- 其余四件套（`$brainstorm-plus` 等）不受影响，因为它们是手工调用的

### 9.2 Claude Code Hook 前提

当前仓库的 Claude Code hook（`.claude/settings.json`）使用了：

- `SessionStart` — 会话启动注入
- `PreToolUse` — Agent/Task 调用前注入 JSONL 上下文
- `SubagentStop` — check agent 停止时触发 Ralph Loop

这些 hook 依赖 Claude Code 原生 hook 能力，通常开箱即用，无需额外配置。

如果 hook 没有生效，检查：

- `.claude/settings.json` 是否存在且格式正确
- Claude Code 版本是否支持对应 hook 事件

---

## 10. 一句话建议

如果你后面真的要把这套当成日常主流程：

- **复杂任务**：默认走四件套
- **简单任务**：继续走 Trellis 原生快路径
- **所有任务**：都保留 `check / finish-work / record-session`

这套组合的核心不是“所有任务都更重”，而是：

**该重的时候更稳，该轻的时候不拖。**

# 自定义 Trellis 维护与安装说明

> 适用对象：这份经过二次开发的 Trellis  
> 目标：回答两个长期问题  
> 1. **上游 Trellis 更新了，我怎么合并？**  
> 2. **其他项目想装我这份 Trellis，我该怎么做？**

---

## 1. 先说最重要的结论

如果你想把这份定制 Trellis **长期传承下去**，你必须把它当成一份**你自己的发行版**，而不是一次性的本地 patch。

也就是说：

- 以后别把它只当“当前目录里改过的一堆文件”
- 要把它当成“我自己的 Trellis 变体”
- 要有：
  - 明确的功能清单
  - 明确的升级策略
  - 明确的安装方式
  - 明确的版本来源

否则，一旦你未来：

- 拉了官方最新版本
- 在别的项目里误装了官方 Trellis
- 或者别人不知道你的定制点在哪

这些扩展能力很容易丢失。

---

## 2. 当前这份自定义 Trellis 具体多了什么

当前你已经额外加入了 7 个 Fusion 能力：

**四件套（计划优先链路）：**

- `brainstorm-plus`
  更强的需求收敛与设计确认，产出 `prd.md + info.md`

- `write-task-plan`
  把需求和设计转成任务内 `plan.md`

- `execute-plan-tdd`
  按 TDD 严格执行 `plan.md`

- `harvest-learnings`
  从 task 中提炼长期有效经验，沉淀回 `.trellis/spec/`

**辅助能力：**

- `systematic-debugging`
  四阶段系统化调试（根本原因 → 模式分析 → 假设测试 → TDD 修复），3 次失败升级为架构讨论

- `review-with-agents`
  两阶段子代理交叉审查（规范审查 + 质量审查），用于高风险复杂任务

- `context-continuity`
  任务执行态持久化层（`.fusion/` 文件 + SessionStart/PreCompact hook + checkpoint/resume 命令），让 agent 在新会话、compact 后、换平台时恢复到"做到哪步、卡在哪、下一步做什么"

**安装工具：**

- `install-fusion.sh`
  一键安装脚本，可把以上 7 个 skill、hooks、scripts 和 commands 安装到任何已初始化的 Trellis 项目

建议把这 7 个能力视为你当前发行版的核心增量能力。

---

## 3. 场景一：上游 Trellis 更新了，怎么合并

### 3.1 先建立正确心智

上游更新时，不是“直接覆盖然后看还能不能跑”，而是做一次**有选择的升级**。

你每次升级都应该回答三个问题：

1. 上游这次新增了什么？
2. 上游这次改动会不会和我的定制冲突？
3. 我的定制里哪些该保留，哪些该删掉，哪些该让位给上游原生能力？

---

### 3.2 推荐的 Git 结构

建议你至少保留两个远程概念：

- `upstream`
  指向官方 Trellis 仓库
- `origin`
  指向你自己的 fork / 私有仓库

推荐做法：

```bash
git remote add upstream https://github.com/mindfold-ai/Trellis.git
git fetch upstream
```

然后让你自己的主线分支保存你的定制版本。

---

### 3.3 每次上游升级时的推荐流程

#### 第一步：先看上游变了什么

至少先看这几处：

- 上游 `README` / `README_CN`
- 上游 changelog
- `packages/cli/src/migrations/manifests/*.json`
- `packages/cli/src/templates/...`
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/update.ts`

特别注意：

- 新增了什么命令 / skill / agent / hook
- 模板路径是否有变化
- `init` / `update` 的行为是否有变化
- 平台差异是否有变化

---

#### 第二步：把上游变更和你的定制点对照

你自己的定制重点主要集中在：

- `.claude/commands/fusion/`
- `.agents/skills/`
- `packages/cli/src/templates/claude/commands/trellis/`
- `packages/cli/src/templates/codex/skills/`
- `packages/cli/test/templates/`
- `.trellis/` 下的补充文档

每次升级时，你要重点 diff 这些目录。

---

#### 第三步：按“保留 / 吸收 / 退休”来取舍

每个自定义能力都应该做一次分类：

### A. 保留

满足任意一条，就继续保留：

- 上游还没有这个能力
- 上游有类似能力，但你的版本更符合你的工作方式
- 你的版本已经沉淀出稳定方法论

### B. 吸收

满足任意一条，可以改成“基于上游重写”：

- 上游开始原生支持类似能力
- 上游的实现更稳、更通用
- 你的版本只是上游能力的一个轻微增强

### C. 退休

满足任意一条，可以删除：

- 上游已经完整覆盖你的需求
- 你的自定义维护成本过高
- 这个能力已经不再值得继续维护

---

### 3.4 取舍的文档依据看哪里

你问“到时候有没有文档告诉我新版更新情况和功能点取舍”，答案是：

**有一部分来自上游文档，但真正能帮你做取舍的，必须是你自己的维护文档。**

具体建议你看三类文档：

#### 上游文档

- 官方 README / 文档站
- migration manifest
- 新版本模板变更

它们告诉你：

- 上游新增了什么
- 上游删了什么
- 上游迁移了什么

#### 你自己的工作流文档

- [融合工作流完整说明](./fusion-workflow.md)
- [默认开 Hook 速查表](./fusion-workflow-quickref.md)

它们告诉你：

- 你这份定制 Trellis 的目标是什么
- 这 4 个能力在整条链路里处于什么位置

#### 这份维护文档

它告诉你：

- 上游更新时该怎么选
- 装到别的项目时该怎么装

---

### 3.5 建议你额外做的一件事

如果你真的想把这套东西长期传下去，我强烈建议你以后补一个：

`FORK_CHANGELOG.md` 或 `CUSTOM_FEATURES.md`

最少记录这几项：

- 功能名
- 目的
- 涉及文件
- 为什么不是直接用上游
- 什么时候引入
- 什么时候被上游替代

这样未来你每次合并上游时，就不会靠记忆判断。

---

### 3.6 一个可执行的上游合并流程

建议你每次升级按这个顺序：

```text
1. fetch upstream
2. 建一个升级分支
3. 先阅读上游 changelog / migration / 模板变化
4. 合并 upstream
5. 检查 4 个自定义能力是否仍然成立
6. 修模板 / 修测试 / 修文档
7. 在一个空白测试项目里跑 init
8. 在一个已有测试项目里跑 update
9. 确认四件套仍然存在
10. 再合回你自己的主分支
```

---

## 4. 场景二：其他项目想装你这份 Trellis，怎么做

这里分 3 种方式。

---

### 4.1 方式 A：同一台机器，多项目复用

这是你现在最适合的方式。

#### 步骤 1：先把 CLI build 出来

在当前 Trellis 仓库里执行：

```bash
cd G:\工作流之间合并调研\Trellis\packages\cli
pnpm install
pnpm build
```

说明：

- `bin/trellis.js` 依赖 `dist/cli/index.js`
- 所以不 build，CLI 是跑不起来的

#### 步骤 2：把这份本地 CLI 链接到全局

推荐：

```bash
npm link
```

这会把你当前这份 `packages/cli` 作为全局 `trellis` 命令使用。

#### 步骤 3：去别的项目里直接用

例如在一个新项目里：

```bash
cd D:\your-new-project
trellis init --claude --codex -u your-name
```

对于已有项目：

```bash
trellis update
```

#### 步骤 4：以后你改了当前 Trellis 仓库怎么办

如果你用的是 `npm link`，大多数情况下只要重新 build：

```bash
cd G:\工作流之间合并调研\Trellis\packages\cli
pnpm build
```

别的项目就会使用新的构建结果。

---

### 4.2 方式 B：本机一次性全局安装本地目录

如果你不想用 `npm link`，也可以直接从本地目录全局安装：

```bash
cd G:\工作流之间合并调研\Trellis\packages\cli
pnpm install
pnpm build
npm install -g .
```

或者从仓库外部执行：

```bash
npm install -g G:\工作流之间合并调研\Trellis\packages\cli
```

这种方式的问题是：

- 以后你改了源码
- 还得重新 `pnpm build`
- 再重新 `npm install -g ...`

所以对你这种频繁改 Trellis 的情况，不如 `npm link` 顺手。

---

### 4.3 方式 C：给别的机器 / 别的人安装

如果不是同一台机器，而是想发给别人，推荐先打包：

```bash
cd G:\工作流之间合并调研\Trellis\packages\cli
pnpm install
pnpm build
npm pack
```

这会生成一个 `.tgz` 包。

然后在目标机器上：

```bash
npm install -g <生成的tgz包路径>
```

之后在目标项目里照常使用：

```bash
trellis init --claude --codex -u your-name
```

---

## 5. 新项目到底该怎么“告诉它使用当前这个目录”

如果你问的是“一个新的项目，怎么让它使用当前这个自定义 Trellis”，最推荐的说法是：

### 本机开发版推荐说法

```text
先在这份自定义 Trellis 的 packages/cli 下执行：
pnpm install
pnpm build
npm link

然后在目标项目里直接运行：
trellis init --claude --codex -u your-name

这样目标项目生成出来的 Trellis 文件，就来自当前这个目录里的自定义版本。
```

这是当前最适合你的方式。

---

## 6. 一个长期风险：你现在的包名还是官方的

这是你后面一定要意识到的问题。

当前 `packages/cli/package.json` 里的包名还是：

```text
@mindfoldhq/trellis
```

这意味着：

- CLI 自检更新时，看的还是这个官方包名
- `trellis update` 的 CLI 升级提示，也会指向官方包

也就是说：

**如果你以后把这份 Trellis 当成长期发行版来给别的项目甚至别人使用，最好不要永远沿用官方包身份。**

---

## 7. 真正长期化时的建议

如果你只是自己本机多项目用：

- 暂时不用改包名
- `npm link` 足够

如果你要团队长期共用，建议做这两件事：

### 7.1 改版本号

例如：

```text
0.4.0-beta.8-fusion.1
```

这样你至少能看出当前 CLI 不是纯官方版。

### 7.2 最好改包名

例如改成你自己的 scope：

```text
@your-scope/trellis
```

这样有几个好处：

- 不会误装官方版
- update 提示不会默认指向官方 npm 包
- 你的 fork 有独立身份
- 别的项目更容易确认“现在装的是你这份”

---

## 8. 最后给你的推荐

### 如果你现在就要在本机别的项目里用

直接用这个：

```bash
cd G:\工作流之间合并调研\Trellis\packages\cli
pnpm install
pnpm build
npm link

cd D:\your-project
trellis init --claude --codex -u your-name
```

---

### 如果你现在就要考虑长期传承

按这个思路做：

1. 把当前仓库当成你的 fork 主仓库
2. 保留 `upstream` 指向官方
3. 每次官方更新时做“保留 / 吸收 / 退休”判断
4. 维护你自己的变更说明文档
5. 后面逐步把包名和版本号改成你自己的发行身份

---

## 9. 相关文档

- [融合工作流完整说明](./fusion-workflow.md)
- [默认开 Hook 的速查表](./fusion-workflow-quickref.md)
- [README 中文版](../README_CN.md)

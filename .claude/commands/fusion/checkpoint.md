---
name: checkpoint
description: "保存当前任务的执行状态到 .fusion/ (关键节点使用)"
---

# Fusion Checkpoint

将当前执行状态保存到 `.fusion/recovery.json` 和 `.fusion/handoff.md`。

## 步骤

1. 确认有活跃任务（读取 `.trellis/.current-task`）
2. 分析当前状态:
   - 读取 `plan.md` 确定当前 slice 进度
   - 读取 `task.json` 获取任务元数据
   - 检查 git status 获取当前工作文件
   - 收集本 session 的关键决策和阻塞
3. 调用 checkpoint 脚本:
   ```bash
   python3 ./.trellis/scripts/fusion/checkpoint.py \
     --slice <当前slice> \
     --status "<当前步骤描述>" \
     --files "<正在编辑的文件>" \
     --source "<当前skill名>" \
     --next "<下一步建议>"
   ```
4. 如需添加 blocker 或 decision:
   ```bash
   python3 ./.trellis/scripts/fusion/checkpoint.py \
     --blocker "描述" \
     --decision "选择了X::因为Y"
   ```
5. 向用户确认保存完成，展示 handoff.md 摘要

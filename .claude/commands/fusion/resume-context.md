---
name: resume-context
description: "语义恢复当前任务的执行状态 (新会话/compact后使用)"
---

# Fusion Resume Context

读取当前任务的 `.fusion/` 恢复数据，重建执行上下文。

## 步骤

1. 运行恢复脚本获取概览:
   ```bash
   python3 ./.trellis/scripts/fusion/resume.py
   ```
2. 读取 `.fusion/recovery.json` 的完整内容（如存在）
3. 读取 `.fusion/handoff.md`（如存在）
4. 读取 `plan.md` 对照进度
5. 如有 `contract.md`，读取验收标准
6. 综合以上信息，输出恢复摘要
7. 询问用户: "从哪一步继续？"

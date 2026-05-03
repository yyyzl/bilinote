#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fusion PreCompact Hook — 在 Claude Code compact 后注入恢复指引。

注意：PreCompact 的 additionalContext 被注入到压缩后的上下文中。
Agent 在 compact 完成后看到此提醒，然后检查/更新 .fusion/ 文件。
"""
import json
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# 复用 recovery_io 的路径解析逻辑（消除 DRY 违反）
_project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
_scripts_dir = _project_dir / ".trellis" / "scripts"
if str(_scripts_dir) not in sys.path:
    sys.path.insert(0, str(_scripts_dir))

try:
    from fusion.recovery_io import get_task_dir_from_current
except ImportError:
    # 如果 recovery_io 不可用（首次安装前），退回内联实现
    def _normalize_task_ref(task_ref: str) -> str:
        normalized = task_ref.strip()
        if not normalized:
            return ""
        path_obj = Path(normalized)
        if path_obj.is_absolute():
            return str(path_obj)
        normalized = normalized.replace("\\", "/")
        while normalized.startswith("./"):
            normalized = normalized[2:]
        if normalized.startswith("tasks/"):
            return f".trellis/{normalized}"
        return normalized

    def get_task_dir_from_current(project_dir: Path):
        trellis_dir = project_dir / ".trellis"
        current_task_file = trellis_dir / ".current-task"
        if not current_task_file.is_file():
            return None
        task_ref = _normalize_task_ref(current_task_file.read_text(encoding="utf-8").strip())
        if not task_ref:
            return None
        path_obj = Path(task_ref)
        if path_obj.is_absolute():
            return path_obj
        if task_ref.startswith(".trellis/"):
            return trellis_dir.parent / path_obj
        return trellis_dir / "tasks" / path_obj


def main():
    project_dir = _project_dir

    # 解析活跃任务
    task_dir = get_task_dir_from_current(project_dir)
    task_info = ""

    if task_dir and task_dir.is_dir():
        task_info = f"\n活跃任务: {task_dir.name}"
        fusion_dir = task_dir / ".fusion"
        if fusion_dir.is_dir():
            recovery_file = fusion_dir / "recovery.json"
            if recovery_file.is_file():
                task_info += "\n已有 .fusion/recovery.json — 请读取并更新"
            else:
                task_info += "\n.fusion/ 目录存在但无 recovery.json — 请创建"
        else:
            task_info += "\n无 .fusion/ 目录 — 建议创建并保存当前状态"

    reminder = f"""<fusion-post-compact-guide>
上下文已被压缩。对话中的细节可能已丢失，但文件中的内容完好。
{task_info}

请立即执行以下操作：

1. 读取恢复数据（如果存在）:
   - .fusion/recovery.json — 当前执行态
   - .fusion/handoff.md — 交接摘要

2. 更新 .fusion/ 状态（如果数据已过时或不存在）:
   - recovery.json: plan_progress / working_set / validation / blockers
   - handoff.md: 已完成 / 阻塞 / 下一步

3. 如有未提交的代码变更，考虑先 git commit

提示: 可使用 /fusion:checkpoint 命令快速保存状态
</fusion-post-compact-guide>"""

    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreCompact",
            "additionalContext": reminder,
        }
    }
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

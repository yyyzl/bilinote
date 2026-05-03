#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fusion Checkpoint — 保存当前执行态到 .fusion/

用法:
  python3 .trellis/scripts/fusion/checkpoint.py [options]

选项:
  --slice S3              当前 slice 编号
  --status "描述"          当前状态描述
  --files "a.ts,b.ts"     当前工作文件列表（逗号分隔）
  --blocker "描述"         添加一个 blocker
  --decision "决策::原因"   添加一个决策（用 :: 分隔决策和原因）
  --source "skill-name"    来源标识（默认 "manual"）

示例:
  python3 .trellis/scripts/fusion/checkpoint.py \\
    --slice S3 --status "S3.red 完成" --files "src/a.ts,src/b.ts"
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# 添加 scripts 目录到 Python path
scripts_dir = Path(__file__).resolve().parent.parent
if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))

from fusion.recovery_io import (
    append_event,
    ensure_fusion_dir,
    get_task_dir_from_current,
    read_recovery,
    write_handoff,
    write_recovery,
)


def get_git_status(project_dir: Path) -> str:
    """获取 git status 摘要。"""
    try:
        result = subprocess.run(
            ["git", "status", "--short"],
            capture_output=True, text=True, encoding="utf-8",
            cwd=project_dir, timeout=5,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def generate_handoff(task_dir: Path, recovery_data: dict) -> str:
    """根据 recovery.json 数据生成 handoff.md 内容。"""
    from datetime import datetime

    progress = recovery_data.get("plan_progress", {})
    current = progress.get("current_slice", "?")
    total = progress.get("total_slices", "?")
    completed = progress.get("completed_slices", [])
    next_action = progress.get("next_recommended_action", "")

    # 读取任务标题
    task_json_path = task_dir / "task.json"
    task_title = task_dir.name
    branch = ""
    if task_json_path.is_file():
        try:
            td = json.loads(task_json_path.read_text(encoding="utf-8"))
            task_title = td.get("title", task_dir.name)
            branch = td.get("branch", "")
        except (json.JSONDecodeError, OSError):
            pass

    working_set = recovery_data.get("working_set", {})
    files = working_set.get("files", [])
    hot_areas = working_set.get("hot_areas", [])
    validation = recovery_data.get("validation", {})
    blockers = recovery_data.get("blockers", [])
    decisions = recovery_data.get("decisions", [])

    lines = [
        "# Session Handoff",
        "",
        f"> 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"> 任务: {task_title}",
    ]
    if branch:
        lines.append(f"> 分支: {branch}")
    lines.append(f"> Slice 进度: {current}/{total}")
    lines.append("")

    # 1. 当前目标
    lines.append("## 1. 当前目标")
    lines.append(recovery_data.get("status", "in_progress"))
    lines.append("")

    # 2. 已完成
    lines.append("## 2. 已完成")
    if completed:
        for s in completed:
            lines.append(f"- [x] {s}")
    else:
        lines.append("- (尚无完成的 slice)")
    lines.append("")

    # 3. 当前阻塞
    lines.append("## 3. 当前阻塞")
    if blockers:
        for b in blockers:
            lines.append(f"- {b}")
    else:
        lines.append("- (无)")
    lines.append("")

    # 4. 当前工作集
    lines.append("## 4. 当前工作集")
    if hot_areas:
        for ha in hot_areas:
            lines.append(f"- `{ha['file']}` (L{ha.get('lines', '?')})")
    elif files:
        for f in files:
            lines.append(f"- `{f}`")
    else:
        lines.append("- (无)")
    lines.append("")

    # 5. 验证状态
    lines.append("## 5. 验证状态")
    build = validation.get("build_status", "unknown")
    test = validation.get("test_status", "unknown")
    failure = validation.get("last_failure_summary", "")
    lines.append(f"- Build: {build}")
    lines.append(f"- Tests: {test}")
    if failure:
        lines.append(f"- Last failure: {failure}")
    lines.append("")

    # 6. 下一步
    lines.append("## 6. 下一步")
    if next_action:
        lines.append(f"1. {next_action}")
    else:
        lines.append("1. (待确定)")
    lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Fusion Checkpoint")
    parser.add_argument("--slice", help="当前 slice 编号")
    parser.add_argument("--status", help="当前状态描述")
    parser.add_argument("--files", help="工作文件列表（逗号分隔）")
    parser.add_argument("--blocker", action="append", help="添加 blocker（可多次使用）")
    parser.add_argument("--decision", action="append", help="添加决策（格式: 决策::原因）")
    parser.add_argument("--source", default="manual", help="来源标识")
    parser.add_argument("--next", dest="next_action", help="下一步建议")
    args = parser.parse_args()

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
    task_dir = get_task_dir_from_current(project_dir)

    if not task_dir or not task_dir.is_dir():
        print("Error: 无活跃任务", file=sys.stderr)
        sys.exit(1)

    # 构建更新数据
    update: dict = {"source": args.source}

    if args.slice or args.status or args.next_action:
        # 读取现有 progress
        existing = read_recovery(task_dir) or {}
        progress = existing.get("plan_progress", {})

        if args.slice:
            # 标记当前 slice，把之前的加入 completed
            old_current = progress.get("current_slice")
            completed = list(progress.get("completed_slices", []))
            if old_current and old_current != args.slice and old_current not in completed:
                completed.append(old_current)
            progress["current_slice"] = args.slice
            progress["completed_slices"] = completed

        if args.status:
            progress["last_completed_step"] = args.status
            update["status"] = "in_progress"

        if args.next_action:
            progress["next_recommended_action"] = args.next_action

        update["plan_progress"] = progress

    if args.files:
        update["working_set"] = {
            "files": [f.strip() for f in args.files.split(",") if f.strip()]
        }

    if args.blocker:
        update["blockers"] = args.blocker

    if args.decision:
        decisions = []
        for d in args.decision:
            parts = d.split("::", 1)
            decisions.append({
                "decision": parts[0].strip(),
                "reason": parts[1].strip() if len(parts) > 1 else "",
            })
        update["decisions"] = decisions

    # 写入 recovery.json
    write_recovery(task_dir, update)
    print(f"[OK] recovery.json updated ({task_dir.name})")

    # 自动生成 handoff.md
    recovery_data = read_recovery(task_dir) or {}
    handoff_content = generate_handoff(task_dir, recovery_data)
    write_handoff(task_dir, handoff_content)
    print(f"[OK] handoff.md updated ({task_dir.name})")

    # 追加事件
    append_event(task_dir, "checkpoint_written", args.source, args.slice)
    print("[OK] event logged")


if __name__ == "__main__":
    main()

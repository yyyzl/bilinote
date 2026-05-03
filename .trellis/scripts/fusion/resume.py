#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fusion Resume — 输出当前任务的恢复包。

用法:
  python3 .trellis/scripts/fusion/resume.py [--full]

选项:
  --full    输出完整恢复包（默认只输出摘要）
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

scripts_dir = Path(__file__).resolve().parent.parent
if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))

from fusion.recovery_io import get_task_dir_from_current, read_handoff, read_recovery


def get_recent_git_info(project_dir: Path) -> str:
    """获取最近 3 个 commit 和当前 git status。"""
    parts = []
    try:
        # git log
        result = subprocess.run(
            ["git", "log", "--oneline", "-3"],
            capture_output=True, text=True, encoding="utf-8",
            cwd=project_dir, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parts.append("Recent commits:")
            parts.append(result.stdout.strip())

        # git status
        result = subprocess.run(
            ["git", "status", "--short"],
            capture_output=True, text=True, encoding="utf-8",
            cwd=project_dir, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parts.append("\nUncommitted changes:")
            parts.append(result.stdout.strip())

        # git branch
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, encoding="utf-8",
            cwd=project_dir, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parts.append(f"\nCurrent branch: {result.stdout.strip()}")

    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return "\n".join(parts)


def main():
    parser = argparse.ArgumentParser(description="Fusion Resume")
    parser.add_argument("--full", action="store_true", help="输出完整恢复包")
    args = parser.parse_args()

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
    task_dir = get_task_dir_from_current(project_dir)

    if not task_dir or not task_dir.is_dir():
        print("无活跃任务")
        return

    # 读取任务信息
    task_json_path = task_dir / "task.json"
    task_title = task_dir.name
    if task_json_path.is_file():
        try:
            td = json.loads(task_json_path.read_text(encoding="utf-8"))
            task_title = td.get("title", task_dir.name)
        except (json.JSONDecodeError, OSError):
            pass

    print(f"# Resume: {task_title}")
    print(f"Task dir: {task_dir}")
    print()

    # Handoff
    handoff = read_handoff(task_dir)
    if handoff:
        print("--- Handoff ---")
        print(handoff)
        print()

    # Recovery
    recovery = read_recovery(task_dir)
    if recovery:
        if args.full:
            print("--- Recovery (full) ---")
            print(json.dumps(recovery, ensure_ascii=False, indent=2))
        else:
            print("--- Recovery (summary) ---")
            progress = recovery.get("plan_progress", {})
            print(f"Phase: {recovery.get('phase', '?')}")
            print(f"Slice: {progress.get('current_slice', '?')}/{progress.get('total_slices', '?')}")
            print(f"Next: {progress.get('next_recommended_action', '?')}")
            blockers = recovery.get("blockers", [])
            if blockers:
                print(f"Blockers: {'; '.join(blockers)}")
        print()

    # Git info
    git_info = get_recent_git_info(project_dir)
    if git_info:
        print("--- Git ---")
        print(git_info)
        print()

    if not handoff and not recovery:
        print("(No .fusion/ recovery data found — Cold Resume only)")
        print("Available: prd.md, plan.md, info.md, task.json")


if __name__ == "__main__":
    main()

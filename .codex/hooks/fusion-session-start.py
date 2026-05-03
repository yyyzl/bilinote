#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Codex Fusion Session Start Hook — Inject .fusion/ recovery data into Codex sessions.

Independent from upstream session-start.py — does NOT modify any existing files.

Output format follows Codex hook protocol:
  stdout JSON → { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }
"""
from __future__ import annotations

import json
import os
import sys
import warnings
from io import StringIO
from pathlib import Path

warnings.filterwarnings("ignore")

if sys.platform == "win32":
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def should_skip_injection() -> bool:
    return os.environ.get("CODEX_NON_INTERACTIVE") == "1"


def read_file(path: Path, fallback: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError, OSError):
        return fallback


def get_task_dir_from_current(project_dir: Path):
    """Resolve the active task directory from .trellis/.current-task."""
    trellis_dir = project_dir / ".trellis"
    current_task_file = trellis_dir / ".current-task"
    if not current_task_file.is_file():
        return None
    task_ref = current_task_file.read_text(encoding="utf-8").strip()
    task_ref = normalize_task_ref(task_ref)
    if not task_ref:
        return None
    path_obj = Path(task_ref)
    if path_obj.is_absolute():
        return path_obj
    if task_ref.startswith(".trellis/"):
        return trellis_dir.parent / path_obj
    return trellis_dir / "tasks" / path_obj


def normalize_task_ref(task_ref: str) -> str:
    """Normalize task refs from .current-task across platforms."""
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


def main() -> None:
    if should_skip_injection():
        sys.exit(0)

    # Read hook input from stdin (Codex protocol)
    try:
        hook_input = json.loads(sys.stdin.read())
        project_dir = Path(hook_input.get("cwd", ".")).resolve()
    except (json.JSONDecodeError, KeyError):
        project_dir = Path(".").resolve()

    task_dir = get_task_dir_from_current(project_dir)
    if not task_dir or not task_dir.is_dir():
        # No active task — nothing to inject
        sys.exit(0)

    fusion_dir = task_dir / ".fusion"
    if not fusion_dir.is_dir():
        # No .fusion/ directory — nothing to inject
        sys.exit(0)

    output = StringIO()
    injected = False

    # 1. Inject handoff.md (short summary, ideal for context)
    handoff_file = fusion_dir / "handoff.md"
    if handoff_file.is_file():
        content = read_file(handoff_file)
        if content.strip():
            output.write("<fusion-handoff>\n")
            output.write(content)
            output.write("\n</fusion-handoff>\n\n")
            injected = True

    # 2. Inject recovery.json key fields summary (not full JSON)
    recovery_file = fusion_dir / "recovery.json"
    if recovery_file.is_file():
        try:
            data = json.loads(recovery_file.read_text(encoding="utf-8"))
            progress = data.get("plan_progress", {})
            if progress:
                current = progress.get("current_slice", "?")
                total = progress.get("total_slices", "?")
                next_action = progress.get("next_recommended_action", "")
                output.write("<fusion-recovery-summary>\n")
                output.write(f"Plan Progress: Slice {current} / {total}\n")
                if next_action:
                    output.write(f"Next Action: {next_action}\n")
                blockers = data.get("blockers", [])
                if blockers:
                    output.write(f"Blockers: {'; '.join(blockers)}\n")
                validation = data.get("validation", {})
                if validation:
                    build = validation.get("build_status", "")
                    test = validation.get("test_status", "")
                    if build or test:
                        output.write(f"Build: {build}, Tests: {test}\n")
                output.write(f"\nFull recovery data: {recovery_file}\n")
                output.write("</fusion-recovery-summary>\n\n")
                injected = True
        except (json.JSONDecodeError, OSError):
            pass

    # 3. Inject contract.md (if present)
    contract_file = fusion_dir / "contract.md"
    if contract_file.is_file():
        content = read_file(contract_file)
        if content.strip():
            output.write("<fusion-contract>\n")
            output.write(content)
            output.write("\n</fusion-contract>\n\n")
            injected = True

    if not injected:
        sys.exit(0)

    # Emit Codex hook protocol output
    context = output.getvalue()
    result = {
        "suppressOutput": True,
        "systemMessage": f"Fusion context injected ({len(context)} chars)",
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        },
    }

    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

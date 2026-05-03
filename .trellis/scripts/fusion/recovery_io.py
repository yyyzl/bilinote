#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fusion Recovery I/O — .fusion/ 文件的读写公共模块。

设计约束:
- recovery.json 只由主 agent (Claude) 写入，其他 agent 只读
- handoff.md 每次全量重写，不追加
- events.jsonl 超过 MAX_EVENT_LINES 行时自动截断
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_EVENT_LINES = 500
TRUNCATE_KEEP_LINES = 300
SCHEMA_VERSION = 1


def get_fusion_dir(task_dir: Path) -> Path:
    """获取 task 对应的 .fusion/ 目录路径。"""
    return task_dir / ".fusion"


def ensure_fusion_dir(task_dir: Path) -> Path:
    """确保 .fusion/ 目录存在，返回路径。"""
    fusion_dir = get_fusion_dir(task_dir)
    fusion_dir.mkdir(parents=True, exist_ok=True)

    # 确保 .gitignore 存在
    gitignore = fusion_dir / ".gitignore"
    if not gitignore.is_file():
        gitignore.write_text(
            "# Fusion: 频繁变化的临时状态不跟踪\n"
            "recovery.json\n"
            "events.jsonl\n"
            "sessions.json\n",
            encoding="utf-8",
        )
    return fusion_dir


def read_recovery(task_dir: Path) -> dict | None:
    """读取 recovery.json，返回 dict 或 None。"""
    recovery_file = get_fusion_dir(task_dir) / "recovery.json"
    if not recovery_file.is_file():
        return None
    try:
        return json.loads(recovery_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def write_recovery(task_dir: Path, data: dict) -> Path:
    """写入 recovery.json。合并现有数据（只更新提供的字段）。"""
    fusion_dir = ensure_fusion_dir(task_dir)
    recovery_file = fusion_dir / "recovery.json"

    # 读取现有数据
    existing = {}
    if recovery_file.is_file():
        try:
            existing = json.loads(recovery_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    # 合并：顶层字段覆盖，decisions 追加
    if "decisions" in data and "decisions" in existing:
        existing_decisions = {d["decision"] for d in existing.get("decisions", [])}
        for d in data["decisions"]:
            if d["decision"] not in existing_decisions:
                existing.setdefault("decisions", []).append(d)
        del data["decisions"]

    existing.update(data)
    existing["schema_version"] = SCHEMA_VERSION
    existing["updated_at"] = datetime.now(timezone.utc).astimezone().isoformat()

    recovery_file.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return recovery_file


def write_handoff(task_dir: Path, content: str) -> Path:
    """全量重写 handoff.md。"""
    fusion_dir = ensure_fusion_dir(task_dir)
    handoff_file = fusion_dir / "handoff.md"
    handoff_file.write_text(content, encoding="utf-8")
    return handoff_file


def read_handoff(task_dir: Path) -> str | None:
    """读取 handoff.md，返回内容或 None。"""
    handoff_file = get_fusion_dir(task_dir) / "handoff.md"
    if not handoff_file.is_file():
        return None
    try:
        return handoff_file.read_text(encoding="utf-8")
    except OSError:
        return None


def append_event(task_dir: Path, event: str, source: str, detail: str | None = None):
    """追加事件到 events.jsonl，超过上限时截断。"""
    fusion_dir = ensure_fusion_dir(task_dir)
    events_file = fusion_dir / "events.jsonl"

    entry = {
        "ts": datetime.now(timezone.utc).astimezone().isoformat(),
        "event": event,
        "source": source,
        "detail": detail,
    }
    line = json.dumps(entry, ensure_ascii=False) + "\n"

    # 追加
    with open(events_file, "a", encoding="utf-8") as f:
        f.write(line)

    # 检查行数，超过上限时截断
    try:
        lines = events_file.read_text(encoding="utf-8").splitlines(keepends=True)
        if len(lines) > MAX_EVENT_LINES:
            # 保留最新的 TRUNCATE_KEEP_LINES 行
            events_file.write_text(
                "".join(lines[-TRUNCATE_KEEP_LINES:]),
                encoding="utf-8",
            )
    except OSError:
        pass


def normalize_task_ref(task_ref: str) -> str:
    """规范化 .current-task 中的任务引用。"""
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


def get_task_dir_from_current(project_dir: Path) -> Path | None:
    """从 .current-task 解析当前任务目录。"""
    trellis_dir = project_dir / ".trellis"
    current_task_file = trellis_dir / ".current-task"
    if not current_task_file.is_file():
        return None
    task_ref = normalize_task_ref(current_task_file.read_text(encoding="utf-8").strip())
    if not task_ref:
        return None
    path_obj = Path(task_ref)
    if path_obj.is_absolute():
        return path_obj
    if task_ref.startswith(".trellis/"):
        return trellis_dir.parent / path_obj
    return trellis_dir / "tasks" / path_obj

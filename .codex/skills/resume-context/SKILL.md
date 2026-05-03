---
name: resume-context
description: "Semantically restore current task execution state from .fusion/ recovery data. Use at the start of a new session or after context compaction."
---

# Fusion Resume Context (Codex)

Read the current task's `.fusion/` recovery data and rebuild execution context.

## When to Use

- At the start of a new Codex session (if not auto-injected by hook)
- After context compaction or memory loss
- When resuming a task after a long pause
- When another agent needs to pick up where you left off

## Steps

1. Run the resume script to get an overview:
   ```bash
   python3 ./.trellis/scripts/fusion/resume.py
   ```
   For full recovery data (including all JSON fields):
   ```bash
   python3 ./.trellis/scripts/fusion/resume.py --full
   ```
2. Read `.fusion/recovery.json` for complete state (if exists)
3. Read `.fusion/handoff.md` for human-readable summary (if exists)
4. Read `plan.md` to cross-reference progress
5. If `contract.md` exists, read acceptance criteria
6. Synthesize all information and output a recovery summary
7. Ask user: "Where should we continue from?"

## Recovery Levels

| Level | Name | Accuracy | Method |
|-------|------|----------|--------|
| 1 | Exact Resume | ~100% | Native session restore (platform-specific) |
| 2 | Semantic Resume | ~85% | `.fusion/` checkpoint data (this skill) |
| 3 | Cold Resume | ~50% | `plan.md` + `task.json` + git history only |

## Output Format

The resume script outputs:
- Task title and directory
- Handoff summary (if available)
- Recovery progress (current slice, next action, blockers)
- Recent git commits and uncommitted changes

## Notes

- If no `.fusion/` data exists, fall back to Cold Resume (Level 3)
- The hook `fusion-session-start.py` auto-injects recovery data at session start
- This skill provides manual/on-demand recovery when auto-injection is insufficient

---
name: checkpoint
description: "Save current task execution state to .fusion/ for context recovery across sessions. Use at key milestones, before context compaction, or when switching tasks."
---

# Fusion Checkpoint (Codex)

Save the current execution state to `.fusion/recovery.json` and `.fusion/handoff.md`.

## When to Use

- After completing a significant slice or milestone
- Before a long pause or task switch
- When context usage is approaching ~60%
- After making important technical decisions
- When encountering a blocker worth recording

## Steps

1. Confirm there is an active task (read `.trellis/.current-task`)
2. Analyze current state:
   - Read `plan.md` to determine current slice progress
   - Read `task.json` for task metadata
   - Check `git status` for current working files
   - Collect key decisions and blockers from this session
3. Run the checkpoint script:
   ```bash
   python3 ./.trellis/scripts/fusion/checkpoint.py \
     --slice <current-slice> \
     --status "<current step description>" \
     --files "<files being edited>" \
     --source "<current skill name>" \
     --next "<recommended next step>"
   ```
4. If you need to add a blocker or decision:
   ```bash
   python3 ./.trellis/scripts/fusion/checkpoint.py \
     --blocker "description" \
     --decision "chose X::because Y"
   ```
5. Confirm save completed, show handoff.md summary to user

## Output Files

| File | Purpose |
|------|---------|
| `.fusion/recovery.json` | Machine-readable execution state |
| `.fusion/handoff.md` | Human-readable session handoff summary |
| `.fusion/events.jsonl` | Append-only event log |

## Notes

- The Python script is platform-agnostic; it works the same in Claude Code, Codex, and other platforms
- Only the primary agent writes `recovery.json`; other agents are read-only
- `handoff.md` is fully rewritten each checkpoint (not appended)

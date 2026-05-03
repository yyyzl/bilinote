# Fusion Trellis - Fork Changelog

> Upstream baseline: `@mindfoldhq/trellis 0.4.0-beta.8`
> Fork version: `0.4.0-beta.8-fusion.1`
> Fork purpose: Merge Superpowers plan-first + TDD methodology into Trellis task/spec/journal infrastructure

---

## Custom Capabilities

### brainstorm-plus

| Field | Value |
|-------|-------|
| Introduced | 2026-03-26 |
| Purpose | Deep requirements and design discovery with explicit `info.md` output and HARD-GATE design confirmation |
| Why not upstream | Upstream `brainstorm` lacks dedicated technical design doc (`info.md`) and hard design-approval gate |
| Files | `.agents/skills/brainstorm-plus/SKILL.md`, `.claude/commands/fusion/brainstorm-plus.md` |
| Upstream replacement candidate | If upstream adds `info.md` support and design confirmation gate to native `brainstorm` |

### write-task-plan

| Field | Value |
|-------|-------|
| Introduced | 2026-03-26 |
| Purpose | Generate TDD-first execution plan (`plan.md`) inside task directory from PRD + design |
| Why not upstream | No upstream equivalent for task-local execution planning with TDD slice structure |
| Files | `.agents/skills/write-task-plan/SKILL.md`, `.claude/commands/fusion/write-task-plan.md` |
| Upstream replacement candidate | If upstream adds plan generation with TDD-first slicing |

### execute-plan-tdd

| Field | Value |
|-------|-------|
| Introduced | 2026-03-26 |
| Purpose | Execute `plan.md` slice by slice with strict red-green-refactor discipline and Iron Law enforcement |
| Why not upstream | No upstream equivalent for TDD-driven plan execution |
| Files | `.agents/skills/execute-plan-tdd/SKILL.md`, `.claude/commands/fusion/execute-plan-tdd.md` |
| Upstream replacement candidate | If upstream adds TDD execution mode |

### harvest-learnings

| Field | Value |
|-------|-------|
| Introduced | 2026-03-26 |
| Purpose | Synthesize durable lessons from completed tasks and promote into `.trellis/spec/` |
| Why not upstream | No upstream equivalent for task-to-spec knowledge transfer with aggressive noise filtering |
| Files | `.agents/skills/harvest-learnings/SKILL.md`, `.claude/commands/fusion/harvest-learnings.md` |
| Upstream replacement candidate | If upstream adds spec promotion workflow |

### systematic-debugging

| Field | Value |
|-------|-------|
| Introduced | 2026-03-26 |
| Purpose | Four-phase debugging methodology (root cause → pattern → hypothesis → TDD fix) with 3-failure architectural escalation |
| Why not upstream | Upstream `break-loop` only handles AI loops, not systematic bug investigation |
| Files | `.agents/skills/systematic-debugging/SKILL.md`, `.claude/commands/fusion/systematic-debugging.md` |
| Upstream replacement candidate | If upstream adds structured debugging methodology |

### review-with-agents

| Field | Value |
|-------|-------|
| Introduced | 2026-03-26 |
| Purpose | Two-stage subagent cross-review (spec compliance + code quality) for catching single-agent blind spots |
| Why not upstream | No upstream equivalent for multi-agent cross-review |
| Files | `.agents/skills/review-with-agents/SKILL.md`, `.claude/commands/fusion/review-with-agents.md` |
| Upstream replacement candidate | If upstream adds subagent-based code review |

### context-continuity

| Field | Value |
|-------|-------|
| Introduced | 2026-03-26 |
| Purpose | Task execution state persistence layer — lets agents resume to "where was I, what's blocked, what's next" after new sessions, compact, or platform switches |
| Why not upstream | Upstream has session resume (Level 1) and cold restart from task docs (Level 3), but no semantic resume (Level 2) that preserves execution progress, decisions, and working set |
| Files | `.agents/skills/context-continuity/SKILL.md`, `.claude/hooks/fusion-session-start.py`, `.claude/hooks/fusion-pre-compact.py`, `.trellis/scripts/fusion/recovery_io.py`, `.trellis/scripts/fusion/checkpoint.py`, `.trellis/scripts/fusion/resume.py`, `.claude/commands/fusion/checkpoint.md`, `.claude/commands/fusion/resume-context.md` |
| Upstream replacement candidate | If upstream adds task-level execution state persistence with cross-session recovery |

---

## Structural Decisions

### Overlay installer (2026-03-26)

- `install-fusion.sh` copies all 7 Fusion skills, commands, and docs into any Trellis project
- No need to fork — install into any existing `trellis init` project
- Warns about config.yaml `update.skip` entries needed

### Namespace isolation (2026-03-26)

- Custom Claude Code commands live under `.claude/commands/fusion/` (invoked as `/fusion:*`)
- Custom skills live under `.agents/skills/<skill-name>/` with unique names (7 total)
- Native Trellis commands remain under `/trellis:*` and are not modified
- `config.yaml` `update.skip` only targets custom paths, not entire native directories

### Fork identity (2026-03-26)

- Version: `0.4.0-beta.8-fusion.1`
- Package name: still `@mindfoldhq/trellis` (to be changed if distributing externally)

---

## Upstream Merge Log

| Date | Upstream Version | Action | Notes |
|------|-----------------|--------|-------|
| 2026-03-26 | v0.4.0-beta.8 | Initial fork | Baseline matches upstream main |

---

## How to Use This File

When upstream releases a new version:

1. Read upstream changelog and migration manifests
2. For each custom capability above, classify as **Retain / Absorb / Retire**:
   - **Retain**: upstream still lacks this capability
   - **Absorb**: upstream now covers this; rewrite custom capability on top of upstream
   - **Retire**: upstream fully replaces this; delete custom capability
3. Record the decision in the Upstream Merge Log
4. Update the "Upstream replacement candidate" field if status changed

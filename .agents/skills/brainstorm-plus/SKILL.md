---
name: brainstorm-plus
description: "Deep requirements and design discovery workflow that keeps Trellis task-first PRD capture but adds stronger design confirmation, explicit technical design notes, and a clean handoff to task plan generation. Use when you want a richer brainstorming experience than $brainstorm, when trade-offs need deliberate review, or when you want Superpowers-style design validation inside Trellis tasks."
---

# Brainstorm Plus

Run an enhanced brainstorming flow that preserves Trellis task tracking while adding stronger design checkpoints and a dedicated technical design document.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY task regardless of perceived simplicity. "Simple" tasks are where unexamined assumptions cause the most wasted work.
</HARD-GATE>

## Goal

Produce a task that is ready for implementation planning with:

- a stable `prd.md`
- a concrete `info.md`
- explicit trade-off decisions
- a clear handoff to `$write-task-plan`

## Core Principles

1. **Task first**
   Always anchor the conversation to a Trellis task directory.

2. **Research before preference questions**
   Inspect repo patterns, docs, configs, and similar implementations before asking the user to choose.

3. **One question per message**
   Ask only the highest-value blocking or preference question.

4. **Design must be confirmed**
   Do not stop at vague requirements. Present the proposed design in sections and get explicit confirmation.

5. **Requirements and design live separately**
   - `prd.md` = what / why / acceptance criteria
   - `info.md` = architecture / flows / risks / testing approach

6. **Plan is a separate artifact**
   Do not put the execution breakdown into `prd.md` or `info.md`. Hand off to `$write-task-plan`.

## Deliverables

- `.trellis/tasks/<task>/prd.md`
- `.trellis/tasks/<task>/info.md`

## Workflow

### 1. Ensure a task exists

If no current task exists, create one immediately and seed `prd.md` with the known facts.

### 2. Gather context before asking

Inspect:

- likely code paths
- existing specs and guides
- similar implementations
- constraints from tooling, runtime, or architecture

Write those findings back into `prd.md` under temporary assumptions or technical notes.

### 3. Clarify with one question at a time

Only ask:

- blocking questions
- preference questions

Do not ask for information that can be derived by reading the repo.

### 4. Propose concrete approaches

When there are multiple valid paths, present 2-3 concrete approaches with:

- how each works
- pros
- cons
- your recommendation

Record the chosen direction in `prd.md` as an ADR-lite decision.

### 5. Draft `info.md`

Once the direction is clear enough, create or update `info.md` with this structure:

```markdown
# <Task Title> - Technical Design

## Summary

## Architecture

## Key Components

## Data / Control Flow

## Risks and Edge Cases

## Testing Strategy

## Out of Scope
```

### 6. Present design in sections

Present the design incrementally and get confirmation section by section:

1. architecture
2. components and boundaries
3. flow and edge cases
4. testing strategy

If the user changes direction, update both `prd.md` and `info.md`.

### 7. Converge to implementation-ready state

Before finishing, ensure:

- `prd.md` has stable requirements
- `prd.md` has testable acceptance criteria
- `info.md` reflects the chosen design
- out-of-scope is explicit
- unresolved questions are either answered or deliberately deferred

### 8. Checkpoint — Context Continuity

After the design is confirmed, **save key decisions to `.fusion/`** so they survive session boundaries:

```bash
python3 .trellis/scripts/fusion/checkpoint.py \
  --status "brainstorm complete, design confirmed" \
  --source "brainstorm-plus" \
  --decision "chosen approach::rationale" \
  --next "run write-task-plan"
```

### 9. Handoff to planning

Finish with a concise summary and recommend the next step:

```text
Brainstorm complete. The task now has a stable PRD and technical design.
Next step: run $write-task-plan to generate a TDD-first execution plan in this task.
```

## Required Output Quality

### `prd.md` must contain

- goal
- requirements
- acceptance criteria
- definition of done
- out of scope
- decision notes when trade-offs mattered

### `info.md` must contain

- architecture summary
- component boundaries
- main flow
- risks / failure cases
- testing strategy

## Anti-Patterns

- treating brainstorming as only Q&A with no design synthesis
- mixing implementation steps into `prd.md`
- stopping before `info.md` is concrete
- asking multiple low-value questions in one message
- asking the user to invent technical options before repo inspection

## Completion Message

Use a closing message shaped like this:

```text
Brainstorm Plus complete for <task-name>.
- PRD updated: <key requirement summary>
- Technical design updated: <key architecture summary>
- Remaining open items: <none or short list>

Next step: run $write-task-plan.
```

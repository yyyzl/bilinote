---
name: harvest-learnings
description: "Synthesize durable lessons from the current task and promote them into .trellis/spec/ without polluting specs with one-off task noise. Reads the task artifacts, changed files, tests, and design decisions, then updates the right spec documents or explicitly decides that no durable spec update is needed. Use after implementation and before finish-work."
---

# Harvest Learnings

Capture the durable lessons from the current task and write them back into `.trellis/spec/`.

## Goal

Turn task-specific execution knowledge into reusable project guidance by:

- reading the current task artifacts
- reviewing changed files and validation work
- identifying durable lessons
- updating the correct code-spec or guide documents
- avoiding low-signal documentation churn

## When To Use

Use this after implementation work has stabilized, especially when you:

- discovered a new reusable pattern
- made a design decision worth preserving
- fixed a subtle bug
- learned a gotcha that future sessions should avoid
- introduced or changed executable contracts
- added a testing rule or verification pattern others should follow

## What Counts As A Durable Learning

Good candidates:

- a reusable implementation pattern
- a constraint that is easy to violate
- a design decision with trade-offs
- a command / API / payload / env contract
- a validation matrix or test rule that future work should follow

Bad candidates:

- one-off task history
- temporary workaround notes
- progress narration
- file-specific noise with no reuse value
- obvious facts already present in code or tests

If the task produced no durable lesson, say so explicitly and do not force a spec edit.

## Core Rules

1. **Promote signal, not history**
   `.trellis/spec/` stores reusable guidance. Session history belongs in journals, not specs.

2. **Prefer existing files**
   Update an existing spec file when possible instead of creating scattered new documents.

3. **Code-spec vs guide**
   - implementation rules and contracts -> `backend/`, `frontend/`, `unit-test/`, etc.
   - thinking checklists and reminders -> `guides/`

4. **Executable depth for infra/cross-layer work**
   If the lesson is about contracts or boundaries, record signatures, payloads, validation, and tests instead of vague prose.

5. **No duplicate churn**
   Merge into the current structure and avoid repeating what the spec already says.

## Workflow

### 1. Gather task evidence

Read:

- `prd.md`
- `info.md` if present
- `plan.md` if present
- changed files
- tests added or modified
- current relevant spec files

Use the active task if one exists.

### 2. Extract candidate learnings

From the task, identify:

- design decisions
- reusable code patterns
- common mistakes avoided
- new or changed contracts
- testing or verification lessons

Write a short candidate list before editing specs.

### 3. Filter aggressively

For each candidate, ask:

- will this matter again?
- would a future agent likely miss this without documentation?
- does it belong in a reusable spec instead of a session journal?

Only keep candidates that pass this filter.

### 4. Map each learning to the correct target

Choose the target file by intent:

- implementation conventions -> `.trellis/spec/<package>/<layer>/...`
- cross-layer or architecture thinking reminders -> `.trellis/spec/guides/...`
- testing lessons -> the relevant test or quality spec

If the right file is unclear, read the relevant index first and choose the closest existing home.

### 5. Update the spec

When editing:

- explain the lesson clearly
- state why it matters
- add concrete examples when useful
- add contracts, matrices, and test points for infra/cross-layer topics
- keep the addition concise and merge-friendly

### 6. Update index files if needed

If you add a new section or a new file, update the corresponding `index.md`.

### 7. Checkpoint — Context Continuity

After learnings are promoted, **save the harvest results to `.fusion/`** so the task state reflects the completed knowledge transfer:

```bash
python3 .trellis/scripts/fusion/checkpoint.py \
  --status "harvest complete, specs updated" \
  --source "harvest-learnings" \
  --next "run check and finish-work"
```

### 8. Report what was harvested

Summarize:

- which lessons were promoted
- which spec files changed
- which candidates were rejected as task-local noise

## Relationship To `update-spec`

Use `harvest-learnings` when you want a task-end synthesis pass.

Use `update-spec` when:

- you already know the exact spec gap
- you need a focused code-spec update during implementation
- you are working on a specific infra/cross-layer contract change

`harvest-learnings` may end up making the same kinds of edits as `update-spec`, but its job is to **discover and filter** the learnings first.

## Completion Message

Use a closing message shaped like this:

```text
Learning harvest complete for <task-name>.

Promoted to spec:
- <lesson 1> -> <spec path>
- <lesson 2> -> <spec path>

Rejected as task-local noise:
- <item or "none">

Next steps:
1. Run $check
2. Run $finish-work
3. After human testing and commit, run $record-session
```

# Write Task Plan

Generate a task-local implementation plan that is detailed enough for disciplined execution and keeps the plan inside the Trellis task directory.

## Goal

Create or update:

- `.trellis/tasks/<task>/plan.md`

The plan should translate:

- `prd.md`
- `info.md`
- relevant `.trellis/spec/` guidance
- existing code patterns

into an execution document that is:

- TDD-first
- small-slice
- explicit about files and commands
- easy to resume in later sessions

## Preconditions

Before writing the plan, verify:

- a task exists
- `prd.md` is stable enough to implement
- `info.md` exists for non-trivial tasks

If requirements are still unstable, stop and recommend `/fusion:brainstorm-plus` or `/trellis:brainstorm`.

## Planning Rules

1. **Plan stays inside the task**
   Save the output to `plan.md` in the current task directory, not under `docs/`.

2. **One slice should produce meaningful progress**
   Each slice should be independently understandable and verifiable.

3. **TDD is mandatory**
   Every behavior slice should follow:
   - write failing test
   - verify fail
   - implement minimal code
   - verify pass
   - refactor if needed

4. **Requirements are not plan steps**
   Keep `prd.md` as the source of truth for requirements. `plan.md` only describes execution.

5. **Exact paths and exact checks**
   Use concrete file paths, commands, and expected outcomes whenever they can be known.

6. **Prefer minimal sequencing**
   Keep the number of slices small enough to maintain momentum, but explicit enough to avoid ambiguity.

## Workflow

### 1. Locate the active task

Use the current task if one is active. If none is active, determine which task the user wants to plan for.

### 2. Read planning inputs

Read:

- `prd.md`
- `info.md` if present
- relevant spec indexes and specific guidelines
- existing code patterns that the implementation should follow

### 3. Map file responsibilities

Before writing plan steps, identify:

- files to create
- files to modify
- tests to add or update
- commands required for verification

### 4. Break the work into execution slices

For each slice, define:

- objective
- files involved
- TDD sequence
- verification
- notes about dependencies or ordering

### 5. Write `plan.md`

Use this shape:

```markdown
# <Task Title> - Execution Plan

## Inputs

- PRD: `prd.md`
- Design: `info.md`
- Relevant specs:
  - `<spec path>` - <why>

## File Map

- Create: `<path>` - <responsibility>
- Modify: `<path>` - <responsibility>
- Test: `<path>` - <coverage>

## Execution Slices

### Slice 1: <name>

**Goal**

<what this slice delivers>

**Files**

- `<path>`

- [ ] Write the failing test first
  - File: `<test path>`
  - Behavior: `<what should fail>`

- [ ] Run the focused test and confirm the expected failure
  - Command: `<command>`
  - Expected: `<why it fails>`

- [ ] Implement the minimal code to pass
  - File: `<impl path>`
  - Constraint: `<minimal implementation note>`

- [ ] Re-run focused tests
  - Command: `<command>`
  - Expected: PASS

- [ ] Run broader verification
  - Command: `<command>`

### Slice 2: <name>
...

## Risks / Watch Items

- <risk>

## Ready-to-Execute Summary

- First slice to start with: <slice>
- Blocking dependencies: <none or list>
```

### 6. Self-review the plan

#### Placeholder scan (mandatory)

Scan the entire plan for any of the following. If found, fix inline before presenting to the user:

- `TBD`, `TODO`, `FIXME`, `XXX`
- `add appropriate ...`, `implement as needed`, `handle errors properly`
- `similar to Slice N` without repeating the actual steps
- steps that reference types, functions, or variables not yet defined
- verification commands that say `<command>` instead of a real command
- slices that say "implement the feature" without concrete file paths and test names

**If any placeholder survives the scan, the plan is not ready.**

#### General quality check

Also check for:

- missing file paths
- steps that skip TDD
- references to requirements not present in `prd.md`
- slices that are too large or too vague

### 7. Finish with execution guidance

End by telling the user the plan is ready and how to proceed.
Recommend starting execution with a slice budget of 1 unless the user explicitly asks for a larger run.

## Completion Message

Use a closing message shaped like this:

```text
Task plan written to .trellis/tasks/<task>/plan.md.

Highlights:
- <number> execution slices
- TDD-first sequence for each slice
- Key files identified: <short list>

Next step: run /fusion:execute-plan-tdd from Slice 1 with a slice budget of 1, keeping tests red before green. Only increase the budget if the user explicitly wants a larger run.
```

## Anti-Patterns

- writing a plan before requirements are stable
- mixing design decisions and execution steps in the same section
- vague steps like "implement the feature"
- omitting tests or putting them after implementation
- putting plan output in a global docs directory instead of the task

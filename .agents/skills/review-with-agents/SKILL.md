---
name: review-with-agents
description: "Two-stage cross-review using subagents: spec compliance review first (does code match PRD?), then code quality review (is it well-built?). Each stage uses an independent subagent with isolated context to catch blind spots the implementer missed. Use after all execute-plan-tdd slices are complete for complex or high-risk tasks where single-agent self-review is not enough."
---

# Review With Agents

Cross-review the current task's implementation using independent subagents that have not seen the implementation process.

## Goal

Catch blind spots that single-agent self-review misses by dispatching two independent reviewers:

1. **Spec compliance reviewer** — does the code match the PRD and design?
2. **Code quality reviewer** — is the code well-built, tested, and maintainable?

## When To Use

This is **optional** but recommended for:

- complex tasks (3+ files changed, cross-layer, new architecture)
- high-risk changes (auth, payments, data migration)
- tasks where you are not confident in the implementation
- tasks where the PRD has many acceptance criteria

Skip for:

- simple single-file changes
- tasks already reviewed through `$check`
- trivial fixes where the test already proves correctness

## Core Rules

1. **Spec review before quality review**
   Do not run quality review until spec compliance passes. Wrong code that is clean is still wrong.

2. **Do not trust the implementer's report**
   Reviewers must read the actual code, not just the implementer's summary.

3. **Review loops must close**
   If a reviewer finds issues, fix them, then re-review. Do not skip the re-review.

4. **One reviewer at a time**
   Do not dispatch multiple reviewers in parallel. Spec compliance first, then quality.

## Workflow

### 1. Gather review context

Read:

- `prd.md` — what was requested
- `info.md` — what was designed
- `plan.md` — what was planned
- the actual changed files — what was implemented

### 2. Dispatch spec compliance reviewer

Use the Agent tool to dispatch a subagent with the spec reviewer prompt.

Provide the subagent with:

- the full text of requirements from `prd.md`
- the acceptance criteria
- a summary of what the implementer claims was built
- the file paths to review

The spec reviewer checks:

- **Missing requirements** — anything requested but not implemented?
- **Extra work** — anything built that was not requested?
- **Misunderstandings** — requirements interpreted differently than intended?

The reviewer reports:

- **PASS** — code matches spec
- **ISSUES** — list of specific gaps with file:line references

### 3. Fix spec compliance issues

If the spec reviewer found issues:

1. Fix each issue
2. Re-dispatch the spec reviewer
3. Repeat until PASS

### 4. Dispatch code quality reviewer

Only after spec compliance passes.

Use the Agent tool to dispatch a subagent with the quality reviewer prompt.

Provide the subagent with:

- the changed files
- a summary of what was implemented
- the git diff

The quality reviewer checks:

- code clarity and naming
- test coverage and test quality
- single responsibility per file
- no unnecessary complexity
- no code smells or anti-patterns
- follows existing codebase patterns

The reviewer reports:

- **Critical** — must fix before delivery
- **Important** — should fix before delivery
- **Minor** — nice to have, can defer

### 5. Fix quality issues

If the quality reviewer found Critical or Important issues:

1. Fix each issue
2. Re-dispatch the quality reviewer
3. Repeat until no Critical or Important issues remain

Minor issues can be deferred.

### 6. Report review results

Summarize:

- spec compliance: pass/fail and what was checked
- quality review: findings and what was fixed
- remaining minor items (if any)

## Spec Reviewer Prompt Template

When dispatching the spec compliance reviewer subagent, use this structure:

```
You are reviewing whether an implementation matches its specification.

## What Was Requested

[Full text of requirements from prd.md and acceptance criteria]

## What Implementer Claims They Built

[Summary from execute-plan-tdd completion]

## CRITICAL: Do Not Trust the Report

Read the actual code. Compare to requirements line by line.

DO NOT take implementer's word for what was implemented.
DO verify everything independently by reading files.

## Your Job

Read the implementation code and verify:

- Missing requirements: anything requested but not implemented?
- Extra work: anything built that was not requested?
- Misunderstandings: requirements interpreted differently?

Report:
- PASS (if everything matches after code inspection)
- ISSUES: [list with file:line references]
```

## Quality Reviewer Prompt Template

When dispatching the code quality reviewer subagent, use this structure:

```
You are reviewing code quality for a completed implementation.

## What Was Implemented

[Summary of changes]

## Files To Review

[List of changed files]

## Your Job

Review the implementation for:

- Code clarity: clear names, readable logic, no unnecessary complexity
- Test quality: tests verify behavior (not mocks), edge cases covered
- Single responsibility: each file has one purpose
- Codebase consistency: follows existing patterns
- No code smells: duplication, magic numbers, deep nesting

Report findings as:
- Critical: must fix (bugs, security, broken tests)
- Important: should fix (unclear code, missing tests, poor names)
- Minor: nice to have (style, minor improvements)
```

## Anti-Patterns

- running quality review before spec compliance passes
- trusting implementer's report without reading code
- skipping re-review after fixes
- dispatching both reviewers in parallel
- accepting "close enough" on spec compliance
- fixing minor issues before Critical/Important ones

## Completion Message

Use a closing message shaped like this:

```text
Agent review complete for <task-name>.

Spec compliance: PASS (after N rounds)
Quality review: PASS (Critical: 0, Important: 0 fixed, Minor: N deferred)

Issues fixed:
- <issue 1>
- <issue 2>

Deferred minor items:
- <item or "none">

Next steps:
1. Run $harvest-learnings
2. Run $check
3. Run $finish-work
```

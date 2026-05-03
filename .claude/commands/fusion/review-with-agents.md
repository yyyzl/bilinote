# Review With Agents

Cross-review the current task using independent subagents to catch blind spots.

## When To Use

**Recommended** for complex or high-risk tasks. **Skip** for simple single-file changes.

## Two Stages (in order)

### Stage 1: Spec Compliance Review

Dispatch a subagent to verify the implementation matches `prd.md`:

- Missing requirements?
- Extra work not requested?
- Misunderstandings?

If issues found: fix → re-review → repeat until PASS.

### Stage 2: Code Quality Review

Only after spec compliance passes.

Dispatch a subagent to review code quality:

- Code clarity and naming
- Test coverage and quality
- Single responsibility
- Codebase pattern consistency

Findings are graded: Critical / Important / Minor.
Fix Critical and Important before delivery. Minor can defer.

## How To Dispatch

Use the Agent tool. Provide the subagent with:

**For spec review:**
- Full requirements text from `prd.md`
- Acceptance criteria
- What was claimed to be built
- File paths to review

**For quality review:**
- Changed files and git diff
- Summary of what was implemented

See the SKILL.md for full prompt templates.

## Core Rules

1. Spec before quality — wrong code that is clean is still wrong
2. Do not trust implementer's report — reviewers must read actual code
3. Review loops must close — found issues → fix → re-review
4. One reviewer at a time — no parallel dispatch

## Completion Message

```text
Agent review complete for <task-name>.

Spec compliance: PASS (after N rounds)
Quality review: PASS (Critical: 0, Important: 0 fixed, Minor: N deferred)

Next steps:
1. Run /fusion:harvest-learnings
2. Run /trellis:check
3. Run /trellis:finish-work
```

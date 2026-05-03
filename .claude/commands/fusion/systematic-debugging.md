# Systematic Debugging

Find root cause before attempting fixes. Random patches waste time and create new bugs.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you have not completed Phase 1, you cannot propose fixes.

## The Four Phases

Complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

1. **Read error messages carefully** — stack traces, line numbers, error codes
2. **Reproduce consistently** — exact steps, every time
3. **Check recent changes** — `git diff`, recent commits, config changes
4. **Gather evidence in multi-component systems** — log data at each component boundary, run once to find WHERE it breaks
5. **Trace data flow** — follow bad values backward to their source

### Phase 2: Pattern Analysis

1. **Find working examples** — similar working code in the same codebase
2. **Compare against references** — read reference implementations completely
3. **Identify differences** — list every difference between working and broken
4. **Understand dependencies** — what components, settings, environment does this need

### Phase 3: Hypothesis and Testing

1. **Form a single hypothesis** — "I think X is the root cause because Y"
2. **Test minimally** — smallest possible change, one variable at a time
3. **Verify** — worked? Phase 4. Did not work? New hypothesis. Do NOT add more fixes on top.

### Phase 4: Implementation

1. **Create a failing test case** — simplest reproduction, automated, MUST have before fixing
2. **Implement a single fix** — root cause only, ONE change, no bundled improvements
3. **Verify the fix** — test passes, no regressions, issue resolved

### When 3+ Fixes Fail

**STOP. Question the architecture.**

Signs of an architectural problem:
- Each fix reveals problems in a different place
- Fixes require massive refactoring
- Each fix creates new symptoms elsewhere

Discuss with the user before attempting more fixes.

## Red Flags — STOP and Return to Phase 1

- "Quick fix for now, investigate later"
- "Just try changing X"
- "Add multiple changes, run tests"
- "It is probably X, let me fix that"
- "One more fix attempt" (when already tried 2+)
- Proposing solutions before tracing data flow

## Common Rationalizations (all wrong)

| Excuse | Reality |
|--------|---------|
| "Issue is simple" | Simple issues have root causes too. |
| "Emergency, no time" | Systematic is FASTER than thrashing. |
| "Just try this first" | First fix sets the pattern. |
| "Multiple fixes at once" | Cannot isolate what worked. |
| "I see the problem" | Seeing symptoms is not root cause. |
| "One more attempt" (after 2+) | 3+ = architectural problem. |

## Relationship To Other Commands

| Command | When |
|---------|------|
| `/trellis:break-loop` | AI stuck in repetitive loop |
| `/fusion:systematic-debugging` | You encounter a bug (this command) |
| `/fusion:execute-plan-tdd` | Phase 4 follows the same TDD Iron Law |
| `/fusion:harvest-learnings` | After fixing a subtle bug, promote the lesson |

## Completion Message

```text
Debugging complete for <issue description>.

Root cause: <what was actually wrong>
Fix: <what was changed>
Test: <test that proves it>
Phases traversed: <1-4, how many hypothesis cycles>

Next steps:
1. Run /fusion:harvest-learnings (if the bug revealed a reusable lesson)
2. Run /trellis:check
3. Run /trellis:finish-work
```

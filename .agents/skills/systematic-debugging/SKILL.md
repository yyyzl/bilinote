---
name: systematic-debugging
description: "Four-phase debugging methodology: root cause investigation, pattern analysis, hypothesis testing, and TDD-based fix implementation. Enforces evidence-first discipline and stops random fix attempts. Use when encountering any bug, test failure, or unexpected behavior — especially when under time pressure or after a fix attempt has already failed."
---

# Systematic Debugging

Find root cause before attempting fixes. Random patches waste time and create new bugs.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you have not completed Phase 1, you cannot propose fixes. Period.

## When To Use

Use for ANY technical issue:

- test failures
- bugs in production
- unexpected behavior
- performance problems
- build failures
- integration issues

**Use this ESPECIALLY when:**

- under time pressure (emergencies make guessing tempting)
- "just one quick fix" seems obvious
- you have already tried a fix and it did not work
- you do not fully understand the issue

**Do not skip when:**

- issue seems simple (simple bugs have root causes too)
- you are in a hurry (systematic is faster than thrashing)

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read error messages carefully**
   - Do not skip past errors or warnings
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - If not reproducible, gather more data — do not guess

3. **Check recent changes**
   - `git diff`, recent commits
   - New dependencies, config changes
   - Environmental differences

4. **Gather evidence in multi-component systems**

   When the system has multiple components:

   ```
   For EACH component boundary:
     - Log what data enters the component
     - Log what data exits the component
     - Verify environment and config propagation
     - Check state at each layer

   Run once to gather evidence showing WHERE it breaks.
   THEN analyze evidence to identify the failing component.
   THEN investigate that specific component.
   ```

5. **Trace data flow**
   - Where does the bad value originate?
   - What called this with the bad value?
   - Keep tracing up until you find the source
   - Fix at source, not at symptom

### Phase 2: Pattern Analysis

**Find the pattern before fixing:**

1. **Find working examples**
   - Locate similar working code in the same codebase
   - What works that is similar to what is broken?

2. **Compare against references**
   - If implementing a pattern, read the reference implementation completely
   - Do not skim — read every line

3. **Identify differences**
   - What is different between working and broken?
   - List every difference, however small
   - Do not assume "that cannot matter"

4. **Understand dependencies**
   - What other components does this need?
   - What settings, config, environment?
   - What assumptions does it make?

### Phase 3: Hypothesis and Testing

**Scientific method:**

1. **Form a single hypothesis**
   - State clearly: "I think X is the root cause because Y"
   - Be specific, not vague

2. **Test minimally**
   - Make the SMALLEST possible change to test the hypothesis
   - One variable at a time
   - Do not fix multiple things at once

3. **Verify before continuing**
   - Did it work? → Phase 4
   - Did not work? → Form NEW hypothesis
   - Do NOT add more fixes on top

### Phase 4: Implementation

**Fix the root cause, not the symptom:**

1. **Create a failing test case**
   - Simplest possible reproduction
   - Automated test if possible
   - MUST have before fixing
   - Follow the TDD Iron Law from `$execute-plan-tdd`

2. **Implement a single fix**
   - Address the root cause identified
   - ONE change at a time
   - No "while I am here" improvements
   - No bundled refactoring

3. **Verify the fix**
   - Test passes now?
   - No other tests broken?
   - Issue actually resolved?

4. **If the fix does not work — count your attempts**
   - Fewer than 3 attempts: return to Phase 1 with new information
   - **3 or more attempts: STOP — question the architecture (see below)**

### When 3+ Fixes Fail: Question Architecture

**Pattern indicating an architectural problem:**

- Each fix reveals new shared state, coupling, or problems in a different place
- Fixes require massive refactoring to implement
- Each fix creates new symptoms elsewhere

**STOP and question fundamentals:**

- Is this pattern fundamentally sound?
- Are we sticking with it through sheer inertia?
- Should we refactor architecture instead of continuing to fix symptoms?

**Discuss with the user before attempting more fixes.**

This is NOT a failed hypothesis — this is a wrong architecture.

## Red Flags — STOP and Return to Phase 1

If you catch yourself thinking:

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I will manually verify"
- "It is probably X, let me fix that"
- "I do not fully understand but this might work"
- "One more fix attempt" (when already tried 2+)
- Proposing solutions before tracing data flow

**ALL of these mean: STOP. Return to Phase 1.**

## Common Rationalizations (all wrong)

| Excuse | Reality |
|--------|---------|
| "Issue is simple, do not need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I will write test after confirming fix works" | Untested fixes do not stick. Test first proves it. |
| "Multiple fixes at once saves time" | Cannot isolate what worked. Causes new bugs. |
| "I see the problem, let me fix it" | Seeing symptoms is not understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question pattern, do not fix again. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify | Bug resolved, tests pass |

## Relationship To Other Skills

- **`$break-loop`**: Use when the AI is stuck in a repetitive loop. `systematic-debugging` is for when YOU encounter a bug.
- **`$execute-plan-tdd`**: Phase 4 follows the same TDD Iron Law. Write failing test before fix.
- **`$harvest-learnings`**: After fixing a subtle bug, run harvest-learnings to promote the lesson into spec.

## Checkpoint — Context Continuity

After identifying root cause (Phase 1-2 complete), **save diagnostic findings to `.fusion/`**:

```bash
python3 .trellis/scripts/fusion/checkpoint.py \
  --status "root cause identified" \
  --source "systematic-debugging" \
  --decision "root cause: <description>::<evidence>" \
  --next "implement fix with TDD"
```

This preserves diagnostic conclusions across session boundaries, preventing repeated investigation.

## Completion Message

Use a closing message shaped like this:

```text
Debugging complete for <issue description>.

Root cause: <what was actually wrong>
Fix: <what was changed>
Test: <test that proves it>
Phases traversed: <1-4, how many hypothesis cycles>

Next steps:
1. Run /fusion:checkpoint to persist debugging conclusions
2. Run $harvest-learnings (if the bug revealed a reusable lesson)
3. Run $check
4. Run $finish-work
```

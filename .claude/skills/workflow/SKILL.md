---
name: workflow
description: Workflow orchestration, planning, verification, and task management. Use
  when starting a non-trivial task, when asked how to approach a problem, or when a
  task has 3 or more steps.
usage: "plan this, how should I approach, what's the order of operations, help me
  organize, where do I start"
---

## Plan
- Required for any task with 3+ steps or an architectural decision.
- Write checkable items before touching code.
- State which approach and why. Do not decide silently.
- Check in with the user before starting implementation.
- If something goes sideways: STOP and re-plan.

## Execute
- One subagent per focused task. Keep the main context window clean.
- Offload research, exploration, and parallel work to subagents.
- Mark items complete as you go. Give a high-level summary at each step.
- Do not fix things noticed along the way unless blocking the task. Log to MEMORY.md.
- If a task has more than one unrelated concern: split it.

## Verify
- Never call a task complete without proving it works.
- Diff behavior before and after. Check the logs.
- Ask: "Would a senior engineer approve this?"
- Workflow changed: trigger it and watch the first run.
- Schema changed: verify downstream consumers still work.
- Fix works but cause unknown: keep investigating. An unexplained fix is a future bug.

## Refine
- For non-trivial changes: ask "is there a more elegant way?" before presenting.
- If a fix feels hacky: implement the clean solution instead.
- Skip for simple obvious fixes. Do not over-engineer.
- Challenge your own work before presenting it.

## Task Tracking
1. Write checkable items before touching code.
2. Check in before starting implementation.
3. Mark items complete as you go.
4. Give a high-level summary at each step.
5. Document the result when complete. Note what was done and what to watch for.
6. Add lessons to MEMORY.md after any correction.

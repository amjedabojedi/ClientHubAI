---
name: Stale in-session todo list vs project task
description: When read_task_list disagrees with the assigned project task, trust the project task + git history.
---

The lightweight in-session todo list (returned by `read_task_list` / the auto "read task list" message) can be **stale leftover from a previous, already-finished task** and may describe completely different work than the currently assigned project task.

**Why:** Observed a session assigned project Task #104 (staff drawer navigation) where the auto-read todo list instead listed old `library.tsx` BulkAddForm CSV-mapping items. Those items were already done long ago; git showed no related work in flight.

**How to apply:** On a conflict, treat the **project task state** (the IN_PROGRESS project task the user delegated) plus **git history/`git status`** as the source of truth for what to build. Do a 2-minute check (grep for the todo's subject, `git log`/`git status`) before assuming the todo list is current. Don't start large work off the todo list alone.

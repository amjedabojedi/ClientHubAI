---
name: Stale in-session todo list vs project task
description: When the in-session todo list disagrees with the assigned project task, trust the project task + git history.
---

The lightweight in-session todo list (returned by `read_task_list` / the auto "read task list" message) can be **stale leftover from a previous, already-finished task** and may describe completely different work than the currently assigned project task.

**Why:** Observed a session where the auto-read todo list listed old, already-completed work unrelated to the project task that was actually assigned; git history showed none of that work was in flight.

**How to apply:** On a conflict, treat the **assigned project task** (the IN_PROGRESS task the user delegated) plus **git history / `git status`** as the source of truth for what to build. Do a quick check (grep for the todo's subject, `git log` / `git status`) before assuming the todo list is current. Don't start large work off the todo list alone.

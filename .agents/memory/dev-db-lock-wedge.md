---
name: Dev DB lock wedge
description: A hung users delete (or any simple DML) can be a DB-wide lock pileup, not a test bug — diagnose via pg_stat_activity.
---

A simple `delete from users` that hangs forever may have nothing to do with the test: stale `idle in transaction` backends (from killed test/dev processes) can block a queued `ALTER TABLE` (e.g. the startup-time `report_templates ADD COLUMN IF NOT EXISTS`), and that queued ACCESS EXCLUSIVE lock then blocks every later statement touching FK-related tables — a whole pileup of hours-old "active, wait_event_type=Lock" queries.

**Why:** startup DDL runs on every dev-server boot; one abandoned transaction wedges the queue for all subsequent test runs.

**How to apply:** when DML hangs, check `pg_stat_activity` for `idle in transaction` rows and old Lock-waiting queries first; `pg_terminate_backend` the stale ones. Also: `startDevServer` in test/helpers/browser.ts must kill the whole process group (npx → sh → node), or SIGKILLing the npx wrapper orphans the real server, whose eventual death mid-transaction seeds the next wedge.

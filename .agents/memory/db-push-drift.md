---
name: db:push blocked by practice_configuration drift
description: Why drizzle db:push prompts dangerously on this repo and how to apply schema changes safely
---

`npm run db:push` (drizzle-kit) on SmartHub stops at an interactive prompt
wanting to create/rename `practice_configuration` from `audit_log` — a
PRE-EXISTING schema drift unrelated to your change. Do NOT accept it; it can
rename/drop the wrong table.

**Why:** The live DB and `shared/schema.ts` disagree on that table, so any
push surfaces the prompt regardless of what you changed.

**How to apply additive schema changes safely:** apply the specific
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
directly and idempotently (e.g. via executeSql), then verify, instead of
running db:push. db:push against the localhost proxy also needs
NODE_TLS_REJECT_UNAUTHORIZED=0 (proxy cert vs Azure cert).

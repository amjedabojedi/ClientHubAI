---
name: Browser tests starve on the polluted shared dev DB
description: Why dev-server-spawning tsx/browser suites can't reach green locally in this repl, and how to verify instead
---

Dev-server-spawning suites (anything using `test/helpers/browser.ts` `startDevServer`, e.g. the insurance-*-ui suites) cannot reliably reach green when run **locally** in this repl.

**Why:** the shared development database is polluted with thousands of seeded test therapists. Every dev server (the `Start application` workflow, each test's spawned server, and the `test-privacy` run's per-suite servers) starts the DAILY-SCHEDULE email job, which iterates all those therapists and floods logs while saturating the Postgres connection pool. Under that load even pre-browser seeding (a handful of inserts) crawls for minutes, so a standalone run can sit at 0 bytes of output for a long time while it's merely starved, not hung. Running another dev-server test concurrently with `test-privacy` makes it worse. Stale transactions can also leave queued schema DDL waiting on relation locks; later test cleanup statements then wait behind that queue even after the browser assertions finish.

**How to apply:**
- Don't judge such a suite by a local standalone run; rely on CI (`test-privacy` on a clean checkout, where the pollution is absent) or confirm correctness by mirroring a known-passing sibling suite + `npm run check`.
- The browser helper already drains the child server's stdout/stderr (no pipe deadlock), so empty output is starvation, not a buffer hang.
- If assertions finish but teardown blocks, inspect `pg_stat_activity` for relation-lock queues before changing the test's cleanup logic; retry on a clean database/CI rather than terminating unrelated sessions.
- If you `pkill` a standalone browser test, its `finally` cleanup is skipped — delete the orphaned seed rows (match on the suite's unique name SUFFIX) so they don't pollute the DB further.

---
name: Double-booking race guard for sessions
description: Why session booking uses advisory locks instead of a btree_gist exclusion constraint
---

Concurrent session bookings (single + recurring) are made race-safe with
transaction-scoped Postgres advisory locks (`pg_advisory_xact_lock` keyed on
therapist, then room), combined with the existing in-transaction conflict
re-check. Locks are always taken therapist-first then room (fixed global order)
so concurrent booking transactions cannot deadlock.

**Why not a `btree_gist` EXCLUDE constraint (the originally-suggested approach):**
1. The app intentionally supports overlap overrides (`ignoreConflicts`, user-
   confirmed in the UI) — a hard constraint would permanently break that feature.
2. The live `sessions` table already contains ~90 intentional overlapping pairs,
   so an exclusion constraint cannot even be created without destroying data.
Advisory locks prevent the *accidental race* while preserving deliberate overrides
and requiring no data migration.

**How to apply:** any NEW insert path that can create overlapping sessions should
call `acquireBookingLocks(tx, therapistId, roomId)` inside its `db.transaction`
before the conflict re-check. Conflict errors thrown from the single-booking tx
set `err.slotTaken = true`; the route catch maps that to HTTP 409.

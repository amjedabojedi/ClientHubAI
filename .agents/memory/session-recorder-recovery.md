---
name: Session recorder recovery
description: Durable safety rules for interrupted session audio recordings and transcript recovery.
---

The saved transcript and an unfinished recording attempt are separate states. Recovery must be queried independently so an active attempt cannot hide an already-saved transcript.

**Why:** A browser/tab interruption can leave a transcript row in `recording` status with no finalization. Hiding that row makes repeated starts create orphaned attempts and can block future recording.

**How to apply:** Serialize start, finalize, and discard with the same session-scoped PostgreSQL advisory lock. Only discard the specific unfinished upload after a conditional status check; never delete a ready transcript as part of recovery cleanup. Clear stale browser recovery state after a definitive 404.
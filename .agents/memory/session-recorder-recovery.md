---
name: Session recorder recovery
description: Durable safety rules for interrupted session audio recordings and transcript recovery.
---

The saved transcript and an unfinished recording attempt are separate states. Recovery must be queried independently so an active attempt cannot hide an already-saved transcript.

**Why:** A browser/tab interruption can leave a transcript row in `recording` status with no finalization. Hiding that row makes repeated starts create orphaned attempts and can block future recording.

**How to apply:** Serialize start, finalize, and discard with the same session-scoped PostgreSQL advisory lock. Only discard the specific unfinished upload after a conditional status check; never delete a ready transcript as part of recovery cleanup. Clear stale browser recovery state after a definitive 404.

Legacy recording attempts must be reviewed individually from server-side metadata. A persisted chunk (or buffered transcript content) is potentially recoverable; an attempt with neither is only likely abandoned, not automatically disposable. Recovery and discard are explicit user decisions, and recovery preserves all previously ready rows.

**Why:** Older recorder versions left multiple `recording` rows behind, including empty attempts, and a bulk cleanup or finalize-time deduplication could destroy the only completed clinical transcript.

**How to apply:** Return every visible unfinished attempt without its PHI content, show its classification in the recorder, and scope recovery/discard to the selected upload ID. Keep audit logging on the mutation path.

Rows in `processing` are still active: they block a new start and may be recovered, but must never be discarded by either route or storage.

**Why:** Finalization marks a row `processing` before its last atomic update; allowing discard based on a stale read can delete an active finalize.

**How to apply:** Keep finalize and start on the session advisory lock, make discard delete only `recording`, and expose completed history by explicit transcript ID so recovery never hides an older ready transcript.
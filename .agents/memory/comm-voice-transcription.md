---
name: Communication voice transcription (chunked)
description: Why the Communications voice-note recorder uses in-memory chunk state instead of a DB table.
---

The Communications voice-dictation recorder uses a chunked upload flow
(transcribe-start / transcribe-chunk / transcribe-finalize) modeled on the
session-note recorder, but stores per-upload chunk state in an **in-memory
Map** server-side rather than a DB table like session transcripts do.

**Why:** These dictations are ephemeral working notes — the stitched text is
dropped into a free-text "Details" field and never persisted as PHI by the
transcription routes themselves. A DB table would add schema/migration drift
(see db-push-drift) for no durable benefit.

**How to apply:** A tab close/refresh mid-dictation IS now recoverable
client-side: the recorder persists the uploadId in localStorage (keyed per
client) and mirrors failed-chunk audio into the shared IndexedDB blob store,
then offers a "recover or discard" banner on next open that re-finalizes
whatever the still-running server held. A **server restart** is still NOT
recoverable — the in-memory map is gone, so recovery returns 404 and the UI
clears the stale pointer and tells the user to re-record. A DB-backed store
(mirroring sessionTranscript) is the only thing that would close the
server-restart gap. The single-shot `/api/communications/transcribe` endpoint
is kept for back-compat/short clips.

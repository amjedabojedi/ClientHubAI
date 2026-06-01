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

**How to apply:** Consequence — interrupted dictations are NOT recoverable
across a server restart (the in-memory map is lost). If recovery/persistence
is ever required, that's the point where a DB-backed store (mirroring
sessionTranscript) becomes justified. The single-shot
`/api/communications/transcribe` endpoint is kept for back-compat/short clips.

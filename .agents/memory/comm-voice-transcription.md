---
name: Communication voice transcription (chunked)
description: How the Communications voice-note recorder persists chunk state and why.
---

The Communications voice-dictation recorder uses a chunked upload flow
(transcribe-start / transcribe-chunk / transcribe-finalize) modeled on the
session-note recorder. Per-upload chunk state (per-chunk transcribed text +
upload metadata) is persisted in a DB table (`comm_transcribe_uploads`,
mirroring `session_transcripts` chunk storage) — NOT an in-memory map.

**Why DB-backed:** A server restart/redeploy used to wipe the in-memory map, so
an interrupted dictation returned 404 on recovery and was lost. Persisting chunk
state closes the server-restart gap (client already recovers tab-close/refresh
via a localStorage uploadId + IndexedDB failed-chunk mirror).

**How to apply:**
- These are still ephemeral working notes (stitched text drops into a free-text
  Communications field, never persisted as PHI by these routes). Rows are
  DELETED on finalize and swept on each transcribe-start (rows older than the
  30-min TTL, by `last_activity_at`). There is no background interval sweeper.
- Chunks are stored as a JSONB map `{ [chunkIndex]: text }`, merged atomically
  per chunk via `COALESCE(chunks,'{}') || jsonb_build_object(...)` (same pattern
  as `appendTranscriptChunk`). Pass the merge value as a parameterized
  `JSON.stringify(text)::jsonb` — do NOT inline-escape it into raw SQL.
- finalize consumes the upload (deletes the row); a later chunk/finalize for the
  same uploadId then 404s — matches the old in-memory delete behavior.
- The single-shot `/api/communications/transcribe` endpoint is kept for
  back-compat/short clips and does not touch this table.
- Schema was applied additively via executeSql (CREATE TABLE/INDEX IF NOT
  EXISTS), not db:push — see db-push-drift.

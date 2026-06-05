# Record Session — Technical Handoff

> Voice-to-text session transcription for SmartHub.
> Generated from the live codebase. Self-contained: another developer or AI agent can rebuild the feature from this document alone.

**Primary source files**

| Layer | File |
|-------|------|
| Frontend recorder UI/logic | `client/src/components/session-recorder.tsx` |
| Failed-chunk recovery store | `client/src/lib/recording-blob-store.ts` (IndexedDB) |
| Backend API routes | `server/routes.ts` (`/api/sessions/:sessionId/transcribe-*`) |
| Whisper integration | `server/ai/openai.ts` (`transcribeSessionChunk`, `withWhisperFallback`, `sanitizeWhisperHallucinations`) |
| Live preview proxy (optional) | `server/ai/deepgram-live.ts` (WebSocket `/ws/transcribe-live`) |
| Persistence | `shared/schema.ts` (`session_transcripts`), `server/storage.ts` (`appendTranscriptChunk`, `finalizeTranscriptAtomic`) |

---

## 1. Feature Overview

The **Record Session** feature lets a therapist record a therapy session by speaking into their device. The browser captures microphone audio, splits it into short, independently-decodable audio chunks, and streams each chunk to the backend. The backend transcribes every chunk with OpenAI Whisper (`gpt-4o-mini-transcribe`) and persists the text. When the therapist stops, the server stitches all chunks **in order** into a single timestamped transcript and saves it to the session.

**Why it exists:** clinicians need an accurate written record of sessions without typing during the appointment. The transcript also feeds SmartHub's AI session-notes pipeline. The design prioritises **no data loss** (every chunk accounted for before saving), **HIPAA/GDPR safety** (auth + explicit AI-processing consent before any audio is processed), and **resilience** (chunk retries, offline detection, crash recovery).

Two transcription paths exist:
- **Whisper chunked pipeline (authoritative):** every ~20s audio slice is uploaded and transcribed; this is always the saved source of truth.
- **Deepgram live WebSocket (optional, preview only):** provides low-latency live captions while recording. It is only used as the *saved* transcript as a fallback when no Whisper chunks were uploaded at all (e.g. a recording stopped before the first slice rotated).

This document focuses on the authoritative Whisper chunked pipeline.

---

## 2. User Flow

1. Therapist opens a session and clicks **Record Session**.
2. The app calls `POST /api/sessions/:sessionId/transcribe-start`. The server checks session access + AI-processing consent, then mints an opaque `uploadId` (`srv-<32 hex chars>`) and creates a `session_transcripts` row with `status='recording'`.
3. The browser requests microphone permission via `navigator.mediaDevices.getUserMedia({ audio: ... })`.
4. Recording starts. `MediaRecorder` is started with a timeslice so it emits a blob roughly every **20 seconds** (`SLICE_SECONDS = 20`).
5. Each emitted blob is normalised into an **independently decodable** WebM file (the WebM init/header segment from the first chunk is prepended to later chunks), assigned a sequential `chunkIndex`, and pushed onto an upload queue. Truly silent chunks are skipped (tracked locally for later silence markers).
6. The queue uploads chunks one at a time to `POST /api/sessions/:sessionId/transcribe-chunk` as `multipart/form-data`. Each chunk gets up to 3 total attempts (initial + 2 retries) with backoff between failures, and failed blobs are backed up to IndexedDB.
7. The backend validates the `uploadId`, enforces a rate limit, sends the chunk audio to the Whisper API, and gets transcript text back.
8. The chunk text is merged into the transcript row's `chunks` JSONB map keyed by `chunkIndex` (atomic merge → no duplicates/clobbering). The response returns the chunk's text so the UI can append it (when Deepgram live preview is not active).
9. Therapist clicks **Stop**. The recorder stops `MediaRecorder`, drains the upload queue, then calls `POST /api/sessions/:sessionId/transcribe-finalize` with the expected chunk count and any silent-chunk indices.
10. The server verifies every expected chunk is accounted for (else `409` so the client can retry), stitches chunks in index order with `[hh:mm:ss]` timestamp headers and `Therapist:` speaker labels (plus gap/silence markers), writes the final text to `content`/`rawContent`, clears `chunks`, sets `status='ready'`, and returns the saved transcript.

---

## 3. Functional Requirements

- **Start recording** — mint a server `uploadId`, request mic, start `MediaRecorder`.
- **Stop recording** — stop capture, flush the queue, finalize.
- **Capture microphone audio** — `getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl } })`.
- **Split audio into chunks** — `MediaRecorder.start(timesliceMs)` (~20s slices).
- **Make each chunk decodable** — prepend the WebM header/init segment to non-first chunks.
- **Send chunks for transcription** — sequential `multipart/form-data` uploads with `chunkIndex`, `uploadId`, `chunkDurationSeconds`.
- **Receive transcript from Whisper** — backend returns `chunkText` per chunk.
- **Append transcript in correct order** — chunks stored by integer index; final stitch iterates `0..maxIndex`.
- **Handle loading states** — `idle | recording | paused | finalizing`; per-chunk "uploading/failed/retry" states.
- **Handle microphone permission errors** — surface a clear error if `getUserMedia` is denied/unavailable.
- **Handle Whisper/API errors** — per-chunk `500` returns let the client retry that chunk; key/provider fallback on the server.
- **Prevent duplicate or missing chunks** — atomic JSONB merge by index dedupes; finalize blocks (`409`) until `uploadedChunks + silentChunks >= expectedChunks`.

---

## 4. Technical Architecture

**Frontend (`session-recorder.tsx`)**
- React component rendering the Record/Stop/Pause controls, live transcript preview, per-chunk status, and error banners.
- `MediaRecorder` config: prefers `audio/webm;codecs=opus` (falls back to `audio/webm`, then `audio/mp4`), `audioBitsPerSecond: 128000`.
- **Chunking + header fixup:** the first blob contains the WebM init segment; `findClusterStart` locates the cluster boundary so the header can be prepended to subsequent blobs, making each uploaded chunk a standalone, decodable file (Whisper needs valid container headers per request).
- **Silence detection:** Web Audio peak-RMS analysis; chunks below `SILENCE_RMS_THRESHOLD = 0.0008` are not uploaded but their `{index, durationSeconds}` are remembered and sent at finalize so the transcript shows `[silence ~Xs]` instead of a hole.
- **Upload queue:** strictly sequential (`uploadQueueRef`) using `FormData`; up to 3 total attempts per chunk (initial + 2 retries) with backoff (≈1s, 2s) between failures; offline + "stalled upload (>90s)" watchdogs; failed blobs persisted to IndexedDB (`recording-blob-store.ts`) and restorable after a refresh/crash; `beforeunload` guard warns before closing mid-recording.
- **Live preview:** optional Deepgram WebSocket (`startLiveTranscription`) drives live captions; if inactive, the UI appends each chunk's returned `chunkText`.

**Backend (`server/routes.ts`)**
- Three Express routes (start / chunk / finalize), all protected by `requireAuth` + `blockAccountant` and `assertSessionAccess` (only the assigned therapist, supervisor, or admin). The `checkAIProcessingConsent(clientId)` gate runs on **start** and **chunk** (where audio is actually processed); finalize does not re-run the consent check. Finalize additionally requires that the caller is the therapist who started the upload (or an admin).
- `audioUpload.single('audio')` (multer, in-memory) parses the chunk upload.
- In-memory per-`(user, session)` rate limiter: `CHUNK_RATE_MAX = 120` per `10 min`.

**Whisper integration (`server/ai/openai.ts`)**
- `transcribeSessionChunk(buffer, fileName, language?, previousText?, translateToEnglish?)` wraps `client.audio.transcriptions.create`.
- `withWhisperFallback` rotates across credentials/providers (personal `OPENAI_API_KEY` → legacy `OPENAI_WHISPER_API_KEY` → Replit AI Integrations) on quota/auth failure.
- `sanitizeWhisperHallucinations` / `collapseRepetitiveHallucinations` strip Whisper's silent-audio artefacts ("Thanks for watching", "subscribe", looped phrases).

**Persistence**
- `session_transcripts` row per recording. While recording, partial text lives in the `chunks` JSONB map; on finalize the stitched text moves to `content`/`rawContent` and `chunks` is nulled.

---

## 5. Data Flow

```
Therapist voice
  → Browser microphone (getUserMedia)
  → MediaRecorder (timeslice ≈ 20s)
  → Blob (WebM/opus)  ──[prepend WebM header so chunk is standalone]──►
  → Sequential upload queue (FormData: audio + chunkIndex + uploadId + duration)
  → POST /api/sessions/:id/transcribe-chunk   (auth + consent + rate limit + uploadId validation)
  → transcribeSessionChunk()  → OpenAI Whisper (gpt-4o-mini-transcribe)
  → transcript text  → sanitizeWhisperHallucinations()
  → appendTranscriptChunk(uploadId, index, text, duration)  [atomic JSONB merge by index]
  → JSON response { chunkText, chunksReceived }  → UI appends preview
  ...repeat per chunk...
  → STOP → POST /api/sessions/:id/transcribe-finalize { uploadId, expectedChunks, silentChunks }
  → verify all chunks accounted for → stitch 0..maxIndex with [hh:mm:ss] + "Therapist:" labels
  → save content/rawContent, status='ready' → return saved transcript
```

---

## 6. API Design

All paths are prefixed with the session id and require an authenticated, authorised therapist (or supervisor/admin). The client AI-processing consent gate is enforced on `transcribe-start` and `transcribe-chunk` (the points where audio is processed); `transcribe-finalize` re-checks session access and upload ownership but does not re-run the consent check.

### 6.1 Start

```
POST /api/sessions/:sessionId/transcribe-start
Content-Type: application/json
```

Request body (all optional):
```json
{ "language": "auto", "translateToEnglish": false }
```

Success `200`:
```json
{ "uploadId": "srv-2f9c4a1b8e7d6c5a0b1f2e3d4c5b6a7f" }
```

Errors: `400` invalid session id · `404` session not found · `403` no access / no AI consent · `500`.

### 6.2 Chunk

```
POST /api/sessions/:sessionId/transcribe-chunk
Content-Type: multipart/form-data
```

Form fields:
| Field | Type | Notes |
|-------|------|-------|
| `audio` | file (Blob) | WebM/opus (or mp4) chunk, standalone-decodable |
| `uploadId` | string | must start with `srv-`, from `transcribe-start` |
| `chunkIndex` | integer | 0-based, sequential |
| `chunkDurationSeconds` | number | actual chunk duration (drives timestamps) |
| `language` | string | optional override |

Success `200`:
```json
{
  "uploadId": "srv-...",
  "chunkIndex": 3,
  "chunkText": "...transcribed text for this chunk...",
  "chunksReceived": 4
}
```

Errors: `400` missing audio / bad uploadId / bad chunkIndex · `404` session or uploadId unknown · `403` no access / consent / started by a different user · `409` upload no longer accepting chunks (already finalized) · `429` rate limit (`Retry-After` header) · `500` chunk transcription failed (client should retry this chunk).

### 6.3 Finalize

```
POST /api/sessions/:sessionId/transcribe-finalize
Content-Type: application/json
```

Request body:
```json
{
  "uploadId": "srv-...",
  "expectedChunks": 12,
  "totalChunks": 12,
  "silentChunks": [ { "index": 5, "durationSeconds": 20 } ]
}
```

Success `200`: the saved `session_transcripts` row, e.g.
```json
{
  "id": 987,
  "sessionId": 123,
  "clientId": 456,
  "content": "[00:00:00]\nTherapist: ...\n\n[00:00:20]\n[silence ~20s — microphone was muted or no speech]\n...",
  "status": "ready",
  "language": "auto",
  "durationSeconds": 240,
  "wordCount": 612
}
```

Errors: `400` missing sessionId/uploadId · `404` session/upload not found · `403` not the recording therapist/admin · `409` `Cannot finalize: only N of M chunks were accounted for` (with `chunksReceived`/`chunksExpected`). Idempotent: re-finalizing a `ready` upload returns it unchanged.

### Generic error shape

```json
{ "message": "human-readable reason" }
```

---

## 7. Code Design

### `client/src/components/session-recorder.tsx`
- **Purpose:** entire front-end recorder — capture, chunking, header fixup, silence detection, upload queue, retries/recovery, live preview, finalize.
- **Key functions:** `handleStart` (consent/start + `getUserMedia` + start `MediaRecorder`), `findClusterStart` (locate WebM cluster boundary to extract/prepend header), the `ondataavailable` handler (build standalone chunk, silence check, enqueue), the upload worker (sequential `FormData` POST + retry/backoff + IndexedDB backup), `startLiveTranscription` (Deepgram preview), `handleStop` (stop, drain queue, finalize).
- **Inputs:** `sessionId`, mic stream, server `uploadId`. **Outputs:** chunk uploads, a saved transcript, UI state.
- **Dependencies:** `MediaRecorder`, Web Audio API, `recording-blob-store.ts`, TanStack Query / fetch, the three backend routes.
- **Key constants:** `SLICE_SECONDS = 20`, `SILENCE_RMS_THRESHOLD = 0.0008`, `audioBitsPerSecond = 128000`, `maxAttempts = 3` per chunk (initial + 2 retries).

### `client/src/lib/recording-blob-store.ts`
- **Purpose:** IndexedDB store for failed/pending audio blobs so a refresh or crash mid-recording doesn't lose audio. **Outputs:** persisted blobs keyed by uploadId+index, restorable on reload.

### `server/routes.ts` — transcribe routes
- **Purpose:** start/chunk/finalize endpoints. **Important logic:** `uploadId` minting (`srv-` + 16 random bytes hex), `checkChunkRate` (120/10min per user+session), per-call session-access re-checks (with the AI-consent gate on start + chunk, and an upload-owner check on finalize), calling `transcribeSessionChunk`, atomic chunk persist, and the finalize stitcher (timestamps, `Therapist:` labels, gap/silence markers, `MAX_CHUNK_INDEX = 500`, missing-chunk `409` guard).
- **Dependencies:** `storage` (`createSessionTranscript`, `getSessionTranscriptByUploadId`, `appendTranscriptChunk`, `finalizeTranscriptAtomic`), `transcribeSessionChunk`, `assertSessionAccess`, `checkAIProcessingConsent`, multer (`audioUpload`).

### `server/ai/openai.ts` — `transcribeSessionChunk`
- **Purpose:** transcribe one audio chunk. **Inputs:** audio `Buffer`, `fileName`, optional `language`, optional `previousText` (continuity), optional `translateToEnglish`. **Output:** cleaned transcript string.
- **Details:** `OpenAI.toFile` with `audio/webm`|`audio/mp4`; `model = gpt-4o-mini-transcribe` (`TRANSCRIPTION_MODEL`); `response_format: 'text'`, `temperature: 0`; `prompt` = clinical keyword domain prompt + last ~200 words of the previous chunk (continuity across seams); optional English translation via a `gpt-4o` chat pass.
- **Dependencies:** `withWhisperFallback` (multi-key/provider), `sanitizeWhisperHallucinations`.

### `server/ai/deepgram-live.ts` (optional preview)
- **Purpose:** server-side WebSocket proxy so the Deepgram API key never reaches the browser; buffers `is_final` transcripts; `awaitLivePersist(uploadId)` is awaited by finalize. Used for the saved transcript only as a fallback when no Whisper chunks exist.

### Storage — `session_transcripts`
- **Columns of note:** `uploadId` (opaque, looked up via an index — not a DB-unique constraint in the schema), `sessionId`, `clientId`, `therapistId`, `language`, `translatedToEnglish`, `chunks` (JSONB `{ "<index>": { text, durationSeconds } }`), `content`, `rawContent`, `durationSeconds`, `wordCount`, `status` (`recording → processing → ready`).
- `appendTranscriptChunk` uses a JSONB build/merge so concurrent or retried writes to the same index set rather than append (idempotent dedupe). `finalizeTranscriptAtomic` flips status and persists stitched text in one statement.

---

## 8. Pseudocode

```text
// ---- START RECORDING ----
function startRecording(sessionId):
    resp = POST /transcribe-start {language, translateToEnglish}   // server checks auth + consent
    uploadId = resp.uploadId
    stream = getUserMedia({ audio: {echoCancellation, noiseSuppression, autoGainControl} })
    recorder = new MediaRecorder(stream, {mimeType: pickSupported(), audioBitsPerSecond: 128000})
    chunkIndex = 0
    header = null
    queue = []
    recorder.ondataavailable = onChunk
    recorder.start(SLICE_SECONDS * 1000)        // emit a blob every ~20s

// ---- CREATE A STANDALONE, DECODABLE CHUNK ----
function onChunk(blob):
    if header == null:
        header = extractWebmHeader(blob)        // bytes before first cluster
        body   = blob
    else:
        body   = concat(header, sliceFromClusterStart(blob))   // prepend header
    duration = measuredDurationOf(blob)
    if rms(blob) < SILENCE_RMS_THRESHOLD:
        silentChunks.push({index: chunkIndex, durationSeconds: duration})   // skip upload
    else:
        queue.push({index: chunkIndex, body, duration})
        pumpQueue()
    chunkIndex += 1

// ---- SEND CHUNKS (sequential, with retry) ----
function pumpQueue():
    if uploading or queue.empty: return
    item = queue.shift(); uploading = true
    for attempt in 1..3:        // 3 total attempts (initial + 2 retries)
        try:
            form = FormData{audio: item.body, uploadId, chunkIndex: item.index,
                            chunkDurationSeconds: item.duration}
            resp = POST /transcribe-chunk form
            appendToPreview(resp.chunkText)      // if no live Deepgram preview
            break
        catch:
            backup(item) to IndexedDB
            sleep(backoff(attempt))              // 1s, 2s, ...
    uploading = false; pumpQueue()

// ---- SERVER: TRANSCRIBE ONE CHUNK ----
function handleChunk(req):
    assertSessionAccess(req); assertConsent(clientId)
    require uploadId startsWith "srv-" and exists and bound to this session+user and status=="recording"
    enforceRateLimit(user, session)              // 120 / 10min
    prev = chunks[chunkIndex - 1]?.text
    text = whisper.transcribe(req.audio, model="gpt-4o-mini-transcribe",
                              prompt = domainKeywords + lastWords(prev, 200),
                              temperature=0, response_format="text")
    text = stripHallucinations(text)
    chunks = atomicJsonbMerge(chunks, chunkIndex, {text, durationSeconds})   // dedupe by index
    return {uploadId, chunkIndex, chunkText: text, chunksReceived: count(chunks)}

// ---- STOP + FINALIZE ----
function stopRecording():
    recorder.stop()
    awaitQueueDrained()
    POST /transcribe-finalize {uploadId, expectedChunks: chunkIndex, silentChunks}

function handleFinalize(req):
    assertSessionAccess(req)
    upload = getByUploadId(uploadId)
    if upload.status == "ready": return upload          // idempotent
    accountedFor = count(upload.chunks) + count(silentChunks)
    if accountedFor < expectedChunks: return 409        // client retries missing chunks
    text = ""; cumulative = 0
    for i in 0..maxIndex(<=500):
        ts = "[" + hhmmss(cumulative) + "]"
        if chunks[i] and chunks[i].text: text += ts + "\nTherapist: " + chunks[i].text
        elif chunks[i]:                  text += ts + "\n[GAP IN RECORDING ~Xs — unintelligible]"
        elif silent[i]:                  text += ts + "\n[silence ~Xs — mic muted]"
        else:                            text += ts + "\n[GAP IN RECORDING — chunk i missing]"
        cumulative += durationOf(i)
    save(upload, content=text, status="ready", chunks=null)
    return upload

// ---- ERROR HANDLING (cross-cutting) ----
on micDenied:        show "Microphone access is required to record."
on offline:          pause uploads, show banner, resume + flush IndexedDB when back online
on chunk 500:        retry (3 attempts total), then mark chunk failed + offer manual Retry
on finalize 409:     re-upload the missing chunk indices, then finalize again
on whisper quota:    server rotates to next key/provider (withWhisperFallback)
```

---

## 9. Edge Cases

| Case | Handling |
|------|----------|
| User denies mic permission | `getUserMedia` rejects → clear error message; recording never starts. |
| User stops almost immediately | If no Whisper chunk rotated yet, finalize falls back to Deepgram live text (if any); otherwise an empty/near-empty transcript is saved. |
| Empty / unintelligible chunk | Whisper returns empty (after hallucination stripping) → stored as empty → stitched as `[GAP IN RECORDING ~Xs — audio was unintelligible]`. |
| Silent chunk (mic muted) | Detected client-side via RMS, skipped from upload, reported in `silentChunks` → `[silence ~Xs]` marker; still counts toward `expectedChunks`. |
| Network failure | Sequential queue retries each chunk up to 3 attempts (initial + 2 retries) with backoff; blob backed up to IndexedDB; offline watchdog pauses/resumes; stalled-upload (>90s) watchdog surfaces a retry. |
| Whisper / API failure | Per-chunk `500` lets the client retry that chunk; server `withWhisperFallback` rotates keys/providers on quota/auth errors. |
| Duplicate chunks | Atomic JSONB merge keyed by `chunkIndex` overwrites rather than appends — no duplicates even on retry. |
| Chunks out of order | Order is by integer index, not arrival; finalize iterates `0..maxIndex`, so arrival order is irrelevant. |
| Missing chunk at finalize | `409` with `chunksReceived`/`chunksExpected`; client must re-upload before saving (data-loss guard). |
| Long sessions | `MAX_CHUNK_INDEX = 500` caps the stitch loop (≈ hours of audio) to prevent OOM from a malicious/buggy client. |
| Browser lacks `MediaRecorder` | Detect support up front; disable Record and show an unsupported-browser message. |
| Tab closed mid-recording | `beforeunload` warns the user; IndexedDB retains un-uploaded blobs for recovery. |
| Wrong/forged uploadId | Must be `srv-`-prefixed, exist in DB, belong to this session, and be owned by the calling user, with `status='recording'` — else `400/403/404/409`. |

---

## 10. Rebuild Instructions

To recreate this feature in another stack while preserving behaviour:

1. **Schema:** a `session_transcripts` table with an opaque, indexed `uploadId` (looked up directly; uniqueness is enforced by the server minting unguessable ids rather than a DB constraint), ownership columns (`sessionId`, `clientId`, `therapistId`), `language`, a JSON `chunks` map (`index → {text, durationSeconds}`), `content`/`rawContent`, `status` (`recording → processing → ready`), and `durationSeconds`/`wordCount`.
2. **Three endpoints** mirroring §6: `start` (auth + consent → mint opaque server `uploadId`, create row), `chunk` (multipart audio + index + uploadId → validate → transcribe → atomic merge by index), `finalize` (verify completeness → stitch in order → save).
3. **Security/consent first:** authenticate every call, authorise that the caller may record this session, require explicit AI-processing consent for the client, and **never** let the client mint its own id — the server mints an unguessable `uploadId` bound to user+session.
4. **Client capture:** `MediaRecorder` with a ~20s timeslice; make each chunk standalone-decodable (prepend the container header to non-first chunks); detect silence client-side and report silent indices at finalize.
5. **Reliable upload:** a strictly sequential queue with bounded retries + backoff, offline/stalled detection, and durable local backup (IndexedDB or equivalent) for crash recovery.
6. **Transcription:** call Whisper (`gpt-4o-mini-transcribe`) per chunk with `temperature=0`, `response_format=text`, a compact domain keyword prompt plus the tail of the previous chunk for continuity; strip known silent-audio hallucinations; optionally translate to English with a chat model.
7. **Ordering & integrity:** store by integer index (idempotent dedupe), and **block finalize until `uploadedChunks + silentChunks >= expectedChunks`**. Stitch `0..maxIndex` with `[hh:mm:ss]` headers, a single speaker label (`Therapist:`), and explicit gap/silence markers so downstream AI never invents content over gaps.
8. **Rate limiting & cost control:** cap chunk uploads per user+session (e.g. 120 / 10 min) and cap the maximum chunk index.
9. **Resilience:** support credential/provider fallback for the speech API; make finalize idempotent.

---

## 11. AI Agent Rebuild Prompt

> **Recreate this "Record Session" feature in Java Spring.**
>
> Build a feature where a therapist records a therapy session by voice from the browser and gets back an accurate, timestamped transcript saved to the session.
>
> **Frontend (browser):** Use `MediaRecorder` to capture microphone audio after requesting permission. Split the audio into ~20-second chunks. Make every chunk an independently decodable file by prepending the WebM (Opus) container header to all chunks after the first. Detect silent chunks locally (RMS threshold) and skip uploading them, but remember their index and duration. Upload chunks **sequentially** (one at a time, in order) to a backend endpoint as `multipart/form-data` including the audio blob, a 0-based `chunkIndex`, the server-issued `uploadId`, and `chunkDurationSeconds`. Retry failed uploads up to 3 times with exponential backoff, back up un-sent blobs to IndexedDB for crash/refresh recovery, warn on tab close, and show loading/error/retry states. Append returned text to a live transcript preview.
>
> **Backend (Java Spring):** Expose three secured REST endpoints:
> 1. `POST /api/sessions/{sessionId}/transcribe-start` — authenticate and authorise the therapist, verify the client granted AI-processing consent, mint an **opaque, unguessable** `uploadId` (e.g. `"srv-" + 16 random bytes hex`) bound to the user + session, create a transcript record with status `recording`, and return `{ "uploadId": "srv-..." }`.
> 2. `POST /api/sessions/{sessionId}/transcribe-chunk` — accept `multipart/form-data` (`audio`, `uploadId`, `chunkIndex`, `chunkDurationSeconds`). Validate that `uploadId` is server-minted (`srv-` prefix), exists, belongs to this session, is owned by the caller, and is still `recording`. Enforce a per-user-per-session rate limit (120 uploads / 10 minutes). Send the audio to the **OpenAI Whisper API** (model `gpt-4o-mini-transcribe`, `temperature=0`, `response_format=text`) with a compact clinical keyword prompt plus the last ~200 words of the previous chunk for continuity. Strip known silent-audio hallucinations. Store the chunk text in a JSON map keyed by `chunkIndex` using an **atomic, idempotent merge** (retries/duplicates must not double-insert). Return `{ uploadId, chunkIndex, chunkText, chunksReceived }`.
> 3. `POST /api/sessions/{sessionId}/transcribe-finalize` — accept `{ uploadId, expectedChunks, silentChunks: [{index, durationSeconds}] }`. Re-check authorisation. **Reject with HTTP 409 unless `uploadedChunks + silentChunks >= expectedChunks`** (no data loss). Then stitch all chunks **in index order** (`0..maxIndex`, capped at 500) into one transcript: each non-empty chunk gets an `[hh:mm:ss]` header (cumulative from durations) and a `Therapist:` label; empty chunks become `[GAP IN RECORDING ~Xs — unintelligible]`; silent indices become `[silence ~Xs]`; missing indices become `[GAP IN RECORDING — chunk N missing]`. Save the stitched text to the record, set status `ready`, clear the chunk map, and return the saved transcript. Make finalize idempotent.
>
> **Cross-cutting requirements:** authenticate and authorise every call; require explicit client AI-processing consent before any audio is processed; never trust a client-supplied id; support fallback across multiple Whisper API keys/providers on quota/auth failure; preserve transcript ordering regardless of upload arrival order; and handle all edge cases (denied mic, empty/silent/duplicate/out-of-order/missing chunks, network and API failures, very long sessions, unsupported browsers). Keep the same user experience: click Record → speak → live preview → Stop → saved timestamped transcript.

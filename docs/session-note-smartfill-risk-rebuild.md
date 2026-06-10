# Session Note Smart Fill (Voice Transcription) & Risk Assessment — Technical Handoff & Rebuild Document

> Feature: After a session is voice-recorded and transcribed, **Smart Fill** turns the full transcript into structured clinical session-note fields with AI; the **Risk Assessment** panel scores 10 clinical risk factors. Both live in the session-note editor.
> This document is implementation-accurate so any engineer (or AI agent) can rebuild the feature from scratch.

---

## 1. Feature Overview

Two related capabilities inside the session note:

**A. Smart Fill (transcript → structured note)**
- A therapist records a session; audio is transcribed in chunks (OpenAI Whisper-class model), optionally **speaker-diarized** (Therapist / Client / Interpreter / Unknown), and saved as one transcript.
- On demand, **Smart Fill** sends that transcript to GPT-4o, which returns a STRICT-JSON structured draft of **7 clinical fields**: `sessionFocus`, `symptoms`, `shortTermGoals`, `intervention`, `progress`, `remarks`, `recommendations`.
- The route **does not write** the note — it returns *suggestions*. The therapist reviews/edits in a dialog and chooses what to apply. This preserves the **Draft → Review → Finalize** human-in-the-loop workflow.
- AI runs **only with client AI-processing consent** (fail-closed → 403). Every run is audit-logged.

**B. Risk Assessment**
- A collapsible panel in the note editor with **10 risk factors**, each scored **0–4** on a labeled scale.
- An **overall score (0–40)** maps to a level: Low / Moderate / High / Critical.
- Scores are **manually entered by the therapist** (clinical judgement). The AI does **not** auto-populate the numeric risk scores — it may only surface "risk indicators" as free text inside the `remarks` field as a prompt for the clinician.

> **Key clinical-safety decision:** the basis for filling note text is *only what is present in the transcript* (the prompt forbids inventing symptoms/diagnoses), and risk numbers are never auto-filled by AI — a licensed human owns the risk judgement.

---

## 2. User Flow

### Smart Fill
1. Therapist opens a session, records audio (`SessionRecorder`), which chunks + transcribes.
2. On finalize, the transcript is stored (optionally diarized into speaker-labeled turns).
3. Therapist clicks **Smart Fill** → `POST /api/sessions/:sessionId/transcript/smart-fill`.
4. Server checks access + **AI consent**; if missing → 403 (and audits `ai_processing_blocked`).
5. Server reads the saved transcript, calls `extractStructuredNoteFromTranscript`, audits `session_transcript_smart_fill`, and returns `{ suggestions }`.
6. `TranscriptSmartFillDialog` shows the 7 suggested fields; therapist edits and applies selected fields into the note form.
7. Therapist completes Risk Assessment, then saves Draft → reviews → **Finalize** (signed off).

### Risk Assessment
1. In the editor, therapist expands the **Risk Assessment** panel.
2. For each of the 10 factors, clicks one of 5 buttons (0–4) with per-factor labels (e.g. None/Mild/Moderate/Severe/Acute).
3. The overall score and level update live (x/40).
4. Scores save with the note into `session_notes` (`risk_*` integer columns).

---

## 3. Functional Requirements

| # | Requirement |
|---|-------------|
| FR1 | Transcribe session audio in chunks; store one transcript per session (optionally speaker-diarized). |
| FR2 | Smart Fill must read the **saved** transcript (not re-transcribe) and return structured suggestions. |
| FR3 | Smart Fill must require client AI-processing consent; fail-closed with 403 when absent. |
| FR4 | The AI must return STRICT JSON with EXACTLY 7 keys; empty string for unsupported fields (no guessing). |
| FR5 | Smart Fill must NOT write the note — only return suggestions for human review/apply. |
| FR6 | Every Smart Fill attempt (success/blocked) must be audit-logged (HIPAA). |
| FR7 | Risk Assessment must score 10 factors 0–4 and compute an overall 0–40 score + Low/Moderate/High/Critical level. |
| FR8 | Risk scores are manually entered; AI must not auto-fill numeric risk scores. |
| FR9 | Output must use professional, third-person clinical language and contain no speaker labels. |
| FR10 | The note workflow must remain Draft → Review → Finalize; AI text starts as draft/generated, not final. |
| FR11 | Cap transcript length sent to the model (~12k words) for predictable token usage. |

---

## 4. Technical Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (React)                                            │
│   SessionRecorder            → chunked record + transcribe   │
│   SessionNotesManager        → note editor + Risk panel      │
│   TranscriptSmartFillDialog  → review/apply AI suggestions   │
└───────────────┬──────────────────────────────────────────────┘
                │ JSON over HTTP
┌───────────────▼──────────────────────────────────────────────┐
│ Backend (Express)                                           │
│   routes.ts                                                 │
│     POST /api/sessions/:id/transcribe-start|chunk|finalize  │
│     POST /api/sessions/:id/transcript/smart-fill            │
│     DELETE /api/sessions/:id/transcript                     │
│   routes-helpers.ts → checkAIProcessingConsent (fail-closed)│
│   ai/openai.ts                                              │
│     transcribeSessionChunk (Whisper)                        │
│     diarizeSessionTranscript (speaker labels)               │
│     extractStructuredNoteFromTranscript (GPT-4o JSON)       │
│     transcribeAndMapAudio (legacy audio→fields, text-block) │
│   AuditLogger → HIPAA audit rows                            │
└───────────────┬──────────────────────────────────────────────┘
                │ OpenAI (Whisper + GPT-4o)
┌───────────────▼──────────────────────────────────────────────┐
│ PostgreSQL: session_transcripts, session_notes (risk_* +    │
│   structured fields + draft/generated/final content)        │
└──────────────────────────────────────────────────────────────┘
```

**Models used:** chunk transcription via a Whisper-class transcription model; diarization + field extraction via **GPT-4o**. Extraction uses `response_format: { type: 'json_object' }`, `temperature: 0.2`, `max_tokens: 4000`.

---

## 5. Data Model (Schema / DB)

`shared/schema.ts`:

- **`session_transcripts`** (one per session) — `content` (full transcript text, speaker-labeled), `clientId`, `wordCount`, status (e.g. `ready`). Read via `storage.getSessionTranscript(sessionId)`.
- **`session_notes`**:
  - **Structured note fields:** `sessionFocus`, `symptoms`, `shortTermGoals` (and the other mapped fields: `intervention`, `progress`, `remarks`, `recommendations`), plus `voice_transcription` (raw transcript copy).
  - **Content lifecycle:** `draft_content` / `generated_content` / `final_content`, `isFinalized` (boolean).
  - **Risk Assessment (integer 0–4 each):** `risk_suicidal_ideation`, `risk_self_harm`, `risk_homicidal_ideation`, `risk_psychosis`, `risk_substance_use`, `risk_impulsivity`, `risk_aggression`, `risk_trauma_symptoms`, `risk_non_adherence`, `risk_support_system`.
- **`audit_logs`** — records `session_transcript_smart_fill`, `ai_processing_blocked`, `session_transcript_deleted`, etc., with `hipaaRelevant`, `riskLevel`.

---

## 6. API Design

### 6.1 `POST /api/sessions/:sessionId/transcript/smart-fill`
Extract structured note fields from the saved transcript. **Does not write the note.**

- **Auth:** `requireAuth` + `blockAccountant` + per-session access check (`assertSessionAccess`).
- **Pre-checks:** transcript must exist and be non-empty; **AI consent** via `checkAIProcessingConsent(transcript.clientId)` — if absent → audit `ai_processing_blocked` + `403`.
- **Action:** `extractStructuredNoteFromTranscript(transcript.content)` → audit `session_transcript_smart_fill`.
- **Response 200:**
```jsonc
{
  "suggestions": {
    "sessionFocus": "…", "symptoms": "…", "shortTermGoals": "…",
    "intervention": "…", "progress": "…", "remarks": "…", "recommendations": "…"
  }
}
```
- **Errors:** `400` invalid id / empty transcript, `403` no AI consent, `404` no transcript/session, `500` (generic message; full error logged server-side to avoid leaking AI/provider details). Request/response timeout raised to 5 minutes.

### 6.2 Transcription endpoints (context)
- `POST /api/sessions/:sessionId/transcribe-start` → mints opaque `uploadId` (`srv-…`).
- `POST /api/sessions/:sessionId/transcribe-chunk` → transcribes a chunk (rate-limited, requires server-minted `uploadId`).
- `POST /api/sessions/:sessionId/transcribe-finalize` → assembles + stores the transcript.
- `DELETE /api/sessions/:sessionId/transcript` → deletes it (audited, high risk).

> Risk Assessment has **no dedicated AI route** — scores are entered in the editor and persisted with the note via the normal session-note save/update endpoint.

---

## 7. Code Design

### `extractStructuredNoteFromTranscript(labeledTranscript)` — `server/ai/openai.ts`
- Returns a `SmartFillNoteSuggestion` with the 7 fields; empty transcript → all-empty object.
- Caps input at **12,000 words**.
- Calls GPT-4o with `response_format: json_object`, temp `0.2`, `max_tokens 4000`.
- **System prompt (basis for filling):** "clinical documentation assistant for a licensed therapist"; receives a **speaker-labeled** transcript (`Therapist:` / `Client:` / `Interpreter:` / `Unknown:`), may be any/mixed language; must return STRICT JSON with EXACTLY the 7 keys. **Per-field guidance** (paraphrased):
  - `sessionFocus` — 1–2 sentences naming central topic(s).
  - `symptoms` — presenting symptoms/distress described or shown (clinical, observable).
  - `shortTermGoals` — goals discussed/agreed for the next 1–4 weeks.
  - `intervention` — techniques used (CBT, MI, psychoeducation, exposure…) with brief description.
  - `progress` — movement toward prior goals / insights gained this session.
  - `remarks` — clinically relevant observations (affect, engagement, **risk indicators**) that don't fit elsewhere.
  - `recommendations` — homework, referrals, next-session focus, safety plans.
- **Hard rules:** use ONLY transcript content (never invent symptoms/diagnoses/meds/events); empty string when unsupported (no guessing); professional third-person ("the client", no "I"); no speaker labels in output; JSON only.
- **Parsing:** `JSON.parse` the response; a `pick()` helper coerces each key to a trimmed string (defaults `''`); parse failure → all-empty object.

### `diarizeSessionTranscript(rawText)` — speaker labeling
- Splits into ~6000-word windows; GPT-4o labels each turn `Therapist:`/`Client:`/`Interpreter:`/`Unknown:` using language-agnostic cues; preserves original wording (no translation/paraphrase); single-voice recordings are all labeled `Therapist:`; passes through bracketed system markers (gaps/silence) untouched.

### `transcribeAndMapAudio(...)` — legacy audio→fields (text-block variant)
- Two-step: transcribe audio, then GPT-4o maps to the SAME 7 fields but returns a **pseudo-labeled text block** (`SESSION FOCUS: …`) parsed by a regex `extractField` helper; "Not addressed in this session" → undefined. (The newer transcript path uses strict JSON instead.)

### Risk scoring — `SessionNotesManager` (`calculateOverallRiskScore`)
- `totalScore = sum(10 factors)`, `max = 40`, `percentage = total/40*100`.
- Thresholds: **≤25% Low** (green), **≤50% Moderate** (yellow), **≤75% High** (orange), **else Critical** (red).
- `updateRiskFactor(key, value)` sets a factor; panel renders a table of 10 factors × 5 buttons with per-factor `scoreLabels`.

### Consent gate — `checkAIProcessingConsent(clientId)` (`server/routes-helpers.ts`)
- Returns `{ hasConsent, message? }`; fail-closed (false on missing/withdrawn/error). Used by all AI routes.

---

## 8. Data Flow

```
record → transcribe-chunk (Whisper) ... → transcribe-finalize
       → [optional] diarizeSessionTranscript → store labeled transcript
Smart Fill click
  → POST /transcript/smart-fill
  → access check + transcript exists + non-empty
  → checkAIProcessingConsent(clientId)         // 403 + audit if absent
  → extractStructuredNoteFromTranscript(content):
        trim to 12k words
        GPT-4o (json_object, temp 0.2)
        parse JSON → 7 string fields (pick → '')
  → audit 'session_transcript_smart_fill'
  → return { suggestions }
TranscriptSmartFillDialog → therapist edits → apply selected fields → note form
Risk panel → manual 0–4 per factor → overall score/level (client-side)
Save Draft → Review → Finalize (risk_* + fields persisted to session_notes)
```

---

## 9. Pseudocode

```text
function smartFillRoute(req):
    session = getSession(req.sessionId); assertAccess
    t = getSessionTranscript(session.id)
    if not t: 404
    if t.content.trim() == "": 400
    if not checkAIProcessingConsent(t.clientId).hasConsent:
        audit('ai_processing_blocked','failure'); return 403
    suggestions = extractStructuredNoteFromTranscript(t.content)
    audit('session_transcript_smart_fill','success')
    return { suggestions }

function extractStructuredNoteFromTranscript(transcript):
    if blank: return EMPTY_7_FIELDS
    text = firstNWords(transcript, 12000)
    resp = gpt4o(json_object, temp=0.2, system=CLINICAL_PROMPT, user=text)
    obj  = tryParseJson(resp) or return EMPTY_7_FIELDS
    return { each of 7 keys: stringOrEmpty(obj[key]) }

function calculateOverallRiskScore(riskFactors):
    total = sum(riskFactors)            # 10 factors, each 0..4
    pct = total / 40 * 100
    if pct <= 25: return {Low}
    if pct <= 50: return {Moderate}
    if pct <= 75: return {High}
    return {Critical}
```

---

## 10. Edge Cases

- **No transcript / empty transcript** → 404 / 400.
- **No AI consent** → 403 + `ai_processing_blocked` audit; nothing sent to the model.
- **AI returns non-JSON / parse failure** → return all-empty suggestions (no crash).
- **Field unsupported by transcript** → empty string (model instructed not to guess).
- **Very long session** → transcript trimmed to 12k words before sending.
- **Mixed/other-language session** → handled; output language matches input, no translation, interpreter lines not double-counted.
- **Single-voice recording** → diarizer labels all turns `Therapist:`.
- **Smart Fill never auto-writes** → therapist must review/apply; risk numbers never AI-filled.
- **AI provider error** → generic 500 to client; full detail logged server-side (no leak).
- **Risk all zeros** → "No risk factors flagged", Low.
- **Long-running request** → server/response timeout raised to 5 min.

---

## 11. Rebuild Instructions

1. **Schema:** add `session_transcripts` (content, clientId, wordCount, status) and to `session_notes` the 7 structured fields, `voice_transcription`, `draft/generated/final_content`, `isFinalized`, and 10 `risk_*` integer columns. `npm run db:generate` → `npm run db:push`.
2. **Consent:** implement `checkAIProcessingConsent` (fail-closed) and gate every AI route with it.
3. **Transcription:** implement chunked transcribe-start/chunk/finalize (server-minted `uploadId`, rate-limited chunk endpoint) and optional `diarizeSessionTranscript`.
4. **Extraction:** implement `extractStructuredNoteFromTranscript` exactly — GPT-4o, `json_object`, temp 0.2, 12k-word cap, the 7-key clinical prompt with hard "no invention / empty-when-unsupported" rules, safe JSON parse with empty fallback.
5. **Route:** `POST /api/sessions/:id/transcript/smart-fill` — access check → transcript checks → consent (403+audit) → extract → audit success → return `{ suggestions }`. Raise timeouts to 5 min. Return generic 500 on AI errors.
6. **Frontend:** `SessionRecorder` (record/chunk), `TranscriptSmartFillDialog` (review/apply 7 fields), `SessionNotesManager` with the Risk Assessment panel (10 factors × 0–4, `calculateOverallRiskScore` thresholds 25/50/75%).
7. **Workflow:** keep AI text as draft/generated; require human review + Finalize before `final_content`/`isFinalized`.
8. **Verify:** `npm run check`; test (a) no-consent → 403; (b) consented → 7 suggested fields; (c) empty transcript → 400; (d) risk scores compute correct level; (e) AI never writes the note directly.

---

## 12. AI Agent Rebuild Prompt

```
You are adding two features to a HIPAA-sensitive therapy app (React frontend;
Express + Drizzle ORM + PostgreSQL backend; OpenAI for Whisper + GPT-4o):
(A) "Smart Fill" that turns a saved session transcript into structured clinical
note fields, and (B) a manual Risk Assessment panel.

DATA MODEL: session_transcripts(content, clientId, wordCount, status). session_notes
gets 7 structured fields (sessionFocus, symptoms, shortTermGoals, intervention,
progress, remarks, recommendations), voice_transcription, draft_content,
generated_content, final_content, isFinalized, and 10 integer risk_* columns
(risk_suicidal_ideation, risk_self_harm, risk_homicidal_ideation, risk_psychosis,
risk_substance_use, risk_impulsivity, risk_aggression, risk_trauma_symptoms,
risk_non_adherence, risk_support_system), each 0–4.

CONSENT: implement checkAIProcessingConsent(clientId) fail-closed (false on
missing/withdrawn/error). Every AI route must call it; on absence return 403 and
audit 'ai_processing_blocked'.

EXTRACTION (server, GPT-4o): extractStructuredNoteFromTranscript(transcript):
- empty transcript → all-empty 7-field object.
- cap input to 12,000 words.
- call GPT-4o with response_format json_object, temperature 0.2, max_tokens 4000.
- SYSTEM PROMPT: clinical documentation assistant; input is a speaker-labeled
  transcript (Therapist:/Client:/Interpreter:/Unknown:), any/mixed language; return
  STRICT JSON with EXACTLY these keys: sessionFocus, symptoms, shortTermGoals,
  intervention, progress, remarks, recommendations. Per-field guidance: sessionFocus
  (1–2 sentence central topic), symptoms (observable clinical distress),
  shortTermGoals (next 1–4 weeks), intervention (techniques + brief desc), progress
  (movement toward prior goals), remarks (affect/engagement/risk indicators),
  recommendations (homework/referrals/next focus/safety plans). HARD RULES: use ONLY
  transcript content (never invent symptoms/diagnoses/meds/events); empty string when
  unsupported (no guessing); professional third-person ("the client", no "I"); no
  speaker labels in output; JSON only.
- parse JSON safely; coerce each key to trimmed string (default ''); parse failure →
  all-empty object.
Optionally implement diarizeSessionTranscript (windowed GPT-4o speaker labeling,
preserve wording, no translation, single-voice → all Therapist:).

ROUTE: POST /api/sessions/:sessionId/transcript/smart-fill (auth + role gate +
per-session access). Load saved transcript (404 if none, 400 if empty), consent
check (403+audit), call extract, audit 'session_transcript_smart_fill', return
{ suggestions }. Raise req/res timeout to 5 min. On AI error return generic 500 and
log full detail server-side. This route must NOT write the note.

FRONTEND: SessionRecorder (chunked record+transcribe), TranscriptSmartFillDialog
(show the 7 suggested fields for review/edit, apply selected into the note form),
SessionNotesManager with a collapsible Risk Assessment panel: 10 factors each with
5 buttons (0–4) and per-factor labels; calculateOverallRiskScore = sum/40 →
percentage thresholds: ≤25 Low, ≤50 Moderate, ≤75 High, else Critical. Risk scores
are MANUAL — never auto-filled by AI.

WORKFLOW: keep AI output as draft/generated; a human reviews and clicks Finalize
before final_content/isFinalized. Audit every AI attempt.

Verify: no-consent → 403; consented → 7 fields; empty transcript → 400; risk math
correct; Smart Fill never writes the note directly.
```

---

### Source map (where to read the real implementation)
- Extraction + diarization + legacy audio map: `server/ai/openai.ts` (`extractStructuredNoteFromTranscript`, `diarizeSessionTranscript`, `transcribeAndMapAudio`)
- Smart Fill route + transcription routes: `server/routes.ts` (`/api/sessions/:sessionId/transcript/smart-fill`, `transcribe-start|chunk|finalize`, transcript DELETE)
- Consent gate: `server/routes-helpers.ts` (`checkAIProcessingConsent`)
- Editor + risk panel: `client/src/components/session-notes/session-notes-manager.tsx` (`calculateOverallRiskScore`, `RISK_FACTOR_CONFIG`, `updateRiskFactor`)
- Recorder + dialog: `client/src/components/session-recorder.tsx`, `client/src/components/session-notes/transcript-smart-fill-dialog.tsx`
- Schema: `shared/schema.ts` (`session_notes` structured + `risk_*` columns, `session_transcripts`)

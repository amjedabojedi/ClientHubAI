# Twilio SMS — Technical Handoff & Rebuild Document

> Feature: **Twilio-powered SMS notifications** in SmartHub (therapy practice management app).
> Covers outbound appointment texts (confirmations + reminders), inbound STOP/START opt-out handling, consent gating, and HIPAA-safe message bodies.
> This document is implementation-accurate so any engineer (or AI agent) can rebuild the feature from scratch.

---

## 1. Feature Overview

SmartHub texts clients **appointment confirmations, reschedules, and reminders** over Twilio, and honors **two-way opt-out/opt-in** (STOP/START) per carrier/TCPA rules.

Key characteristics:

- **Consent-gated & fail-closed** — a client is only texted if they have an explicit, current `sms_notifications` consent. Any missing/withdrawn consent, missing phone, or verification error → **no text**, and the skip is still audit-logged.
- **HIPAA-safe bodies** — messages contain only the practice name ("SmartHub"), the appointment date/time, and a "Reply STOP to opt out." line. **No client name, no clinical detail, no appointment type.**
- **E.164 normalization** — numbers are normalized to E.164 (`+15195551234`) before sending; ambiguous numbers are refused rather than guessed.
- **Two-way opt-out** — an inbound `STOP`/`START` text hits a signed Twilio webhook that flips the client's consent record.
- **Every attempt is audited** — `sms_notification_sent` / `_blocked` / `_failed` / `_skipped` rows are written for HIPAA traceability on every path, including error paths.
- **Graceful when unconfigured** — if the three Twilio secrets are absent, SMS is silently disabled (mirrors the email-provider-down behavior); the app keeps working.
- **Separation of concerns** — `sms-service.ts` only knows *how* to send; it never decides *whether* to text. All gating lives in the notification service.

SMS is triggered server-side by appointment events (e.g. scheduling a session) — there is no "send SMS" button.

---

## 2. User Flow

### A. Outbound appointment text
1. Staff schedules/reschedules an appointment (`POST /api/sessions`, recurring create, etc.).
2. `notificationService.processEvent('session_scheduled', …)` runs.
3. The engine computes recipients; for the **session client** it checks `checkSmsConsent(clientId)`.
4. If consent is present and the phone normalizes to E.164, it builds a PHI-free body and calls Twilio.
5. The outcome (sent/blocked/failed) is written to `audit_logs`.
6. 24-hour reminders are modeled as **scheduled** `session_scheduled` triggers and use reminder wording.

### B. Inbound opt-out / opt-in (STOP / START)
1. Client texts `STOP` (or CANCEL/UNSUBSCRIBE/END/QUIT) — or `START`/`YES`/`UNSTOP` — to the Twilio number.
2. Twilio POSTs to `POST /api/sms/inbound`.
3. The server validates the `X-Twilio-Signature`, classifies the intent, normalizes the `From` number, and matches client(s) by phone.
4. It records a fresh granted consent (opt-in) or withdraws/records an opt-out, and writes a HIPAA audit row.
5. Responds with empty TwiML so Twilio does not retry.

### C. Staff view
- Staff can view a client's SMS delivery history (`GET /api/clients/:id/sms-log`) and export it as CSV (`/sms-log/export`).
- Staff manage a client's SMS consent in the **Consent Panel** UI.

---

## 3. Functional Requirements

| # | Requirement |
|---|-------------|
| FR1 | Send SMS only via Twilio, only when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` are all set. |
| FR2 | Gate every client text on a current `sms_notifications` consent; fail closed on missing/withdrawn/error. |
| FR3 | Normalize destination numbers to E.164; refuse ambiguous numbers (never text a guessed destination). |
| FR4 | SMS bodies must be PHI-free: practice name + date/time + STOP line only. |
| FR5 | Support events: session_scheduled (confirm), session_rescheduled, reminders; scheduled triggers use reminder wording. |
| FR6 | Audit-log every attempt: sent / blocked / failed / skipped — even on unexpected errors. |
| FR7 | Handle inbound STOP/START via a **signature-validated** webhook; flip consent + audit. |
| FR8 | `sendSms` must never throw — always resolve to a result the caller can audit. |
| FR9 | Staff SMS is opt-in only (`notificationPreferences.enableSms`, default OFF). |
| FR10 | Provide staff-facing SMS delivery log (view + CSV export), access-controlled. |
| FR11 | When Twilio is unconfigured, disable SMS gracefully without breaking the app. |

---

## 4. Technical Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (React)                                             │
│   consent-panel.tsx     → toggle sms_notifications consent   │
│   sms-history.tsx       → view delivery log                  │
│   (no direct send; sends are server-triggered by events)    │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ Backend (Express)                                            │
│   notification-service.ts  ── decides WHETHER to text        │
│     processEvent → calculateRecipients → sendSmsNotifications │
│     generateSmsBody (PHI-free), formatSmsDateTime            │
│   routes-helpers.ts        ── checkSmsConsent (fail-closed)  │
│   sms-service.ts           ── decides HOW to text (Twilio)   │
│     isSmsConfigured, getClient, sendSms,                     │
│     classifyInboundSms, validateTwilioSignature             │
│   shared/phone.ts          ── normalizePhoneE164 (pure)      │
│   routes.ts                                                  │
│     POST /api/sms/inbound            (Twilio webhook)        │
│     GET  /api/clients/:id/sms-log    (history)              │
│     GET  /api/clients/:id/sms-log/export (CSV)              │
└───────────────┬──────────────────────────────────────────────┘
                │ Twilio Node SDK
┌───────────────▼──────────────────────────────────────────────┐
│ Twilio API  (messages.create, validateRequest)              │
└──────────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ PostgreSQL: clients(phone, phoneE164), clientConsents,      │
│   notificationPreferences(enableSms), audit_logs            │
└──────────────────────────────────────────────────────────────┘
```

**Design principle:** `sms-service.ts` is intentionally narrow — it never decides *whether* to text, only *how*. All consent/preference gating lives in `notification-service.ts`. This keeps the Twilio dependency isolated and the gating logic testable.

---

## 5. Environment Variables

| Variable | Purpose |
|----------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio account identifier; used to construct the client. |
| `TWILIO_AUTH_TOKEN` | Secret token for the API **and** for validating inbound webhook signatures. |
| `TWILIO_FROM_NUMBER` | The E.164 sender number (the `from` on every outbound message). |

All three are required; `isSmsConfigured()` returns false if any is missing, and SMS is skipped gracefully. (Manage via the platform secrets store — never hardcode.)

---

## 6. Data Model (Schema / DB)

`shared/schema.ts`:

- **`clients`** (and `users` for staff):
  - `phone` — raw user-entered string.
  - `phoneE164` — standardized E.164 copy (`+15195551234`) used for sending; auto-derived (recomputed only when `phone` is patched). Falls back to deriving on the fly for rows saved before backfill.
- **`clientConsents`** — consent ledger (append-style):
  - `clientId`, `consentType` (`'sms_notifications'`), `granted` (boolean), `consentVersion`, `withdrawnAt` (timestamp, null when active), `ipAddress`, `userAgent`, `notes`.
  - "Has consent" = the most recent `sms_notifications` row is `granted` and has no `withdrawnAt`.
- **`notificationPreferences`** — staff-only: `enableSms` (boolean, default **OFF**) per user/trigger.
- **`audit_logs`** — SMS delivery + consent trail; SMS attempts use `resourceType = 'sms_notification'` with actions `sms_notification_sent|blocked|failed|skipped`; inbound opt-out/opt-in logs `consent_granted|consent_withdrawn` with `resourceType='patient_consent'`.

> No dedicated "outbound SMS" table — delivery history is reconstructed from `audit_logs`. The Twilio message SID is stored in the audit details (`messageSid`).

---

## 7. API Design

### 7.1 `POST /api/sms/inbound` (Twilio webhook)
- **Auth:** none (public), but **must** pass `validateTwilioSignature` (checks `X-Twilio-Signature` against the request URL + POST params using the auth token). Invalid/missing → `403` + empty TwiML.
- **Body (form-encoded from Twilio):** `From`, `Body` (plus standard Twilio params).
- **Behavior:** classify intent (opt-out/opt-in/none) → if none, ack and ignore → normalize `From` → match clients by phone → grant/withdraw `sms_notifications` consent → write HIPAA audit row.
- **Response:** always `200` with empty TwiML `<Response></Response>` (even on error) so Twilio doesn't retry.

### 7.2 `GET /api/clients/:id/sms-log`
- **Auth:** `requireAuth` + `blockAccountant` + `auditClientAccess('client_viewed')`.
- **Returns:** filtered `audit_logs` rows where `resourceType = 'sms_notification'` (with outcome/date-range filters).

### 7.3 `GET /api/clients/:id/sms-log/export`
- **Auth:** same as above + `auditDataExport('client_sms_log')`.
- **Returns:** CSV of SMS delivery history (`sms-log-client-<id>-<date>.csv`).

> Outbound sending has **no public route** — it is invoked internally by `notificationService.processEvent(...)`.

---

## 8. Code Design

### `server/sms-service.ts` (the "how")
- `isSmsConfigured(): boolean` — all three env vars present.
- `getClient()` — lazily constructs & caches `twilio(SID, TOKEN)`.
- `sendSms(to, body): Promise<{success, sid?, error?}>` — **never throws**; returns `{success:false,error:"SMS not configured"}` when unconfigured, else `messages.create({to, from: FROM_NUMBER, body})` wrapped in try/catch. Assumes `to` is already E.164.
- `classifyInboundSms(body): "opt-out" | "opt-in" | null` — normalizes to letters-only lowercase; matches whole-word keywords (opt-out: stop/stopall/unsubscribe/cancel/end/quit; opt-in: start/unstop/yes). A sentence merely containing "stop" does **not** unsubscribe.
- `validateTwilioSignature(signature, url, params): boolean` — `twilio.validateRequest(...)`; false on missing token/signature or any error.
- `__setSmsClientForTests(...)` — test seam; throws in production.

### `shared/phone.ts` (pure, browser-safe)
- `normalizePhoneE164(raw): string | null` — `+`-prefixed → digits only (8–15); bare 10-digit → `+1…`; 11-digit starting `1` → `+…`; otherwise **null** (refuse to guess).

### `server/routes-helpers.ts`
- `checkSmsConsent(clientId): {hasConsent, message?}` — reads `getClientConsents`, filters `sms_notifications`, returns `hasConsent:false` if no record, not granted, withdrawn, or on any error (**fail-closed**).

### `server/notification-service.ts` (the "whether")
- `generateSmsBody(trigger, entityData): string | null` — PHI-free copy. If `trigger.isScheduled` → reminder wording; else switch on `eventType` (session_scheduled→confirmed, session_rescheduled→rescheduled, reminders→reminder); unknown → `null`.
- `formatSmsDateTime(value)` — formats in `PRACTICE_TZ` as `EEE, MMM d 'at' h:mm a`; safe fallback `"your scheduled time"`.
- `sendSmsNotifications(recipients, trigger, entityData)` — Path 1 (client, consent-gated) + Path 2 (staff, `enableSms`-gated); audits every outcome via `auditSms(...)`.

---

## 9. Data Flow

### Outbound (client path)
```
event (e.g. session scheduled)
  → notificationService.processEvent(eventType, entityData)
  → calculateRecipients()           // is sessionClient targeted?
  → sendSmsNotifications():
       if !isSmsConfigured(): log + return
       body = generateSmsBody(trigger, entityData)   // PHI-free; null → return
       client = storage.getClient(clientId)
       phone  = client.phoneE164 || normalizePhoneE164(client.phone)
       consent = checkSmsConsent(clientId)
       if !consent.hasConsent → auditSms('sms_notification_blocked','blocked', …)
       else if !phone         → auditSms('sms_notification_blocked','blocked', {reason:'missing/invalid phone'})
       else:
           result = sendSms(phone, body)             // Twilio
           result.success ? auditSms('sms_notification_sent','success',{messageSid})
                          : auditSms('sms_notification_failed','failure',{error})
       (any thrown error) → auditSms('sms_notification_blocked','blocked', fail-closed)
```

### Inbound (STOP/START)
```
Twilio → POST /api/sms/inbound (form-encoded)
  → validateTwilioSignature(sig, url, body)   // 403 if invalid
  → intent = classifyInboundSms(Body)         // null → 200 ignore
  → fromE164 = normalizePhoneE164(From)        // null → 200 ignore
  → clients = storage.getClientsByPhone(fromE164)   // none → 200 ignore
  → for each client:
       opt-in  → createClientConsent(granted:true)
       opt-out → withdrawClientConsent() (or record explicit withdrawn row)
       AuditLogger.logAction(consent_granted|consent_withdrawn, userId:6 SYSTEM, clientId, hipaaRelevant, riskLevel:high)
  → 200 empty TwiML
```

---

## 10. Pseudocode

```text
function sendSms(to, body):
    if not isSmsConfigured(): return {success:false, error:"SMS not configured"}
    try:
        msg = twilioClient.messages.create({to, from: FROM_NUMBER, body})
        return {success:true, sid: msg.sid}
    catch e:
        return {success:false, error: e.message}   # never throw

function checkSmsConsent(clientId):
    try:
        rows = getClientConsents(clientId).filter(type == 'sms_notifications')
        latest = mostRecent(rows)
        if not latest: return {hasConsent:false}
        if not latest.granted or latest.withdrawnAt: return {hasConsent:false}
        return {hasConsent:true}
    catch: return {hasConsent:false}              # fail-closed

function handleInbound(req):
    if not validateTwilioSignature(req.sig, req.url, req.body): return 403 twiml
    intent = classifyInboundSms(req.body.Body)
    if not intent: return 200 twiml
    from = normalizePhoneE164(req.body.From)
    if not from: return 200 twiml
    for client in getClientsByPhone(from):
        if intent == 'opt-in':  createClientConsent(client, granted=true)
        else:                   withdrawClientConsent(client, 'sms_notifications')
        audit(consent_granted|consent_withdrawn, system user, client)
    return 200 twiml
```

---

## 11. Edge Cases

- **Twilio not configured** → `isSmsConfigured()` false → SMS skipped, app unaffected.
- **No / withdrawn consent** → blocked + audited (`sms_notification_blocked`).
- **Consent present but unusable phone** → blocked + audited (`reason: missing or invalid phone number`).
- **Ambiguous phone** (no country code, non-NANP length) → `normalizePhoneE164` returns null → treated as no phone.
- **Twilio API error** → `sendSms` returns `{success:false}` → `sms_notification_failed` audited; never throws.
- **Unexpected exception in client path** → fail-closed + audited as blocked (guarantee: every attempt leaves a record).
- **Unknown event type** → `generateSmsBody` returns null → no send.
- **Inbound forged/unsigned webhook** → `403`, no DB mutation.
- **Inbound from unknown number / non-keyword body** → acknowledged (`200`) and ignored.
- **Inbound matches multiple clients sharing a number** → consent updated for each match.
- **Webhook processing error** → still returns `200` so Twilio doesn't retry a request that can't be processed.
- **Staff SMS** → only when `enableSms=true` (default OFF); otherwise `sms_notification_skipped` audited.
- **PHI guard** → bodies never include client name / clinical detail / appointment type — only practice name, date/time, STOP line.

---

## 12. Rebuild Instructions

1. **Secrets:** add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` to the platform secrets store.
2. **Install:** add the `twilio` Node SDK (use the package manager, not manual `package.json` edits).
3. **Phone helper:** create `shared/phone.ts` with a dependency-free `normalizePhoneE164` (browser-safe). Add a `phoneE164` column to `clients` (and `users`), backfill, and recompute only when `phone` changes. Run `npm run db:generate` then `npm run db:push`.
4. **SMS service** (`server/sms-service.ts`): `isSmsConfigured`, lazy cached `getClient`, `sendSms` (never throws), `classifyInboundSms`, `validateTwilioSignature`, and a production-guarded test seam.
5. **Consent:** ensure a `clientConsents` ledger with `sms_notifications` type; implement `checkSmsConsent` fail-closed in `routes-helpers.ts`.
6. **Notification service:** implement `generateSmsBody` (PHI-free) + `formatSmsDateTime` + `sendSmsNotifications` (client consent path + staff `enableSms` path), auditing every outcome.
7. **Routes:** add the signature-validated `POST /api/sms/inbound` webhook (STOP/START → consent flip + audit, always 200 TwiML) and the `GET /api/clients/:id/sms-log` (+`/export`) history endpoints with access control.
8. **Frontend:** consent toggle (`consent-panel.tsx`) and delivery log (`sms-history.tsx`). No direct-send UI.
9. **Twilio console:** point the messaging number's inbound webhook at `https://<your-domain>/api/sms/inbound`.
10. **Verify:** `npm run check`; then test (a) scheduling with consent → text + `sms_notification_sent`; (b) without consent → blocked + audited; (c) inbound STOP → consent withdrawn + audited; (d) forged webhook → 403.

---

## 13. AI Agent Rebuild Prompt

> Copy-paste this to an AI coding agent to rebuild the feature.

```
You are adding Twilio SMS notifications to a full-stack TypeScript app (React
frontend; Express + Drizzle ORM + PostgreSQL backend) for a HIPAA-sensitive
therapy practice.

GOAL: Text clients appointment confirmations/reschedules/reminders over Twilio,
handle inbound STOP/START opt-out, gate every text on consent, keep message
bodies PHI-free, and audit every attempt.

SECRETS (all required; SMS disabled gracefully if any missing):
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.

ARCHITECTURE (strict separation): an sms-service module knows only HOW to send
(Twilio), never WHETHER. All consent/preference gating lives in the notification
service. Phone normalization lives in a pure, dependency-free shared module so the
browser can reuse it.

DATA MODEL: add `phoneE164` to clients (and users) — a standardized E.164 copy used
for sending, recomputed only when `phone` changes. Use a `clientConsents` ledger
(clientId, consentType, granted, consentVersion, withdrawnAt, ip, userAgent, notes);
"has consent" = latest sms_notifications row granted AND not withdrawn. Staff use
notificationPreferences.enableSms (default OFF). No outbound-SMS table — store
delivery outcomes (incl. Twilio messageSid) in audit_logs with
resourceType='sms_notification'.

SMS SERVICE:
- isSmsConfigured(): all three env vars present.
- getClient(): lazily construct & cache twilio(SID, TOKEN).
- sendSms(to, body): NEVER throws; returns {success, sid?, error?}; calls
  messages.create({to, from: FROM_NUMBER, body}); assumes `to` is E.164.
- classifyInboundSms(body): whole-word keyword match → 'opt-out'
  (stop/stopall/unsubscribe/cancel/end/quit) | 'opt-in' (start/unstop/yes) | null.
  A sentence merely containing "stop" must NOT unsubscribe.
- validateTwilioSignature(sig, url, params): twilio.validateRequest; false on
  missing token/sig or error.
- normalizePhoneE164(raw): +prefixed→digits(8–15); 10-digit→+1…; 11-digit
  starting 1→+…; else null (never guess).

GATING + BODIES:
- checkSmsConsent(clientId): fail-closed (false on no record / not granted /
  withdrawn / any error).
- generateSmsBody(trigger, data): PHI-FREE — practice name + formatted date/time +
  "Reply STOP to opt out." only. Scheduled trigger → reminder wording; eventType
  session_scheduled→confirmed, session_rescheduled→rescheduled, reminders→reminder;
  unknown→null. Never include client name / clinical detail / appointment type.
- sendSmsNotifications: client path (consent → phone → send → audit
  sent/blocked/failed; fail-closed audit on exceptions) + staff path
  (enableSms=true only, else audit skipped).

ROUTES:
- POST /api/sms/inbound (public, Twilio webhook): validateTwilioSignature → 403 if
  invalid; classifyInboundSms (null→200 ignore); normalize From (null→200 ignore);
  getClientsByPhone; per client grant/withdraw sms_notifications consent + write a
  HIPAA audit row (system user id, clientId, riskLevel high); ALWAYS return 200 with
  empty TwiML (even on error) so Twilio doesn't retry.
- GET /api/clients/:id/sms-log (auth + role gate): audit_logs where
  resourceType='sms_notification'.
- GET /api/clients/:id/sms-log/export: CSV of the above.
No public outbound-send route — sending is internal via the notification engine.

FRONTEND: consent toggle for sms_notifications and an SMS delivery-log view. No
direct send button.

EDGE CASES: unconfigured Twilio (skip), no/withdrawn consent (blocked+audit),
unusable/ambiguous phone (blocked+audit), Twilio error (failed+audit, no throw),
unexpected exception (fail-closed+audit), unknown event (no send), forged webhook
(403), unknown inbound number / non-keyword (200 ignore), multiple clients sharing
a number (update each), staff not opted in (skipped+audit). Keep all bodies and
audit details PHI-free.

Point the Twilio number's inbound webhook at /api/sms/inbound. Then typecheck and
verify: consented schedule → sent; no consent → blocked; inbound STOP → withdrawn;
forged webhook → 403.
```

---

### Source map (where to read the real implementation)
- SMS service: `server/sms-service.ts` (`isSmsConfigured`, `getClient`, `sendSms`, `classifyInboundSms`, `validateTwilioSignature`)
- Phone normalization: `shared/phone.ts` (`normalizePhoneE164`)
- Consent gate: `server/routes-helpers.ts` (`checkSmsConsent`)
- Notification engine: `server/notification-service.ts` (`sendSmsNotifications`, `generateSmsBody`, `formatSmsDateTime`)
- Routes: `server/routes.ts` (`POST /api/sms/inbound`, `GET /api/clients/:id/sms-log`, `/sms-log/export`)
- Frontend: `client/src/components/client-management/consent-panel.tsx`, `client/src/components/communications/sms-history.tsx`

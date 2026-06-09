# Recurring Sessions — Technical Handoff & Rebuild Document

> Feature: **Recurring (weekly) appointment booking** in SmartHub (therapy practice management app).
> This document is a complete, implementation-accurate handoff so any engineer (or AI agent) can rebuild the feature from scratch.

---

## 1. Feature Overview

Therapists/admins can book a **weekly recurring series** of sessions for a client in one action instead of creating each appointment by hand.

Key characteristics:

- **Weekly recurrence only** — pick one or more days of the week, repeat every *N* weeks (1–8).
- **Two end modes** — stop after a fixed **count** of sessions, or stop on an **until date**.
- **Preview before booking** — the user sees exactly which dates will be booked and which will be **skipped due to conflicts** (therapist busy / room occupied).
- **Conflict-aware, race-safe creation** — conflicting dates are skipped, not blocked; the rest are inserted atomically with database advisory locks to prevent double-booking.
- **Series linkage** — every occurrence shares one `recurrenceGroupId` (`rec-<UUID>`), which powers "edit this & all future" and "cancel the whole series".
- **One combined notification** — the client gets a single series-confirmation email/SMS, plus per-session reminders (not one confirmation per session).
- **Safety caps** — max **60** sessions per series, never look more than **~2 years (730 days)** ahead, business hours 8:00 AM – 12:00 AM practice time.

There is **no separate recurrence table**. Recurrence is materialized: the rule is expanded into concrete `sessions` rows at creation time, all tagged with the same group id. The rule itself is *not* stored after expansion.

---

## 2. User Flow

### A. Create a recurring series
1. Therapist opens the **"New Session"** dialog (3-step wizard) on the Scheduling page.
2. Selects client, service, therapist, room, type, date, time (steps 1–2).
3. On **Step 3 (Details & Repeat)** toggles **"Repeat weekly"**. The start date is the date chosen above.
4. Picks **Repeat on** days (Mon/Wed…), **interval** (every N weeks), and an **end condition**: a count (e.g. 8) **or** an until-date.
5. Clicks **"Preview dates"** → calls the preview endpoint → sees a list of candidate dates each marked **Free** or **Conflict** (with reason).
6. Clicks **"Book Series"** → backend inserts all free dates, skips conflicts, returns created + skipped lists.
7. Backend sends **one** combined series confirmation to the client and schedules **per-session reminders**.

### B. Edit a recurring series
- Editing a session that has a `recurrenceGroupId` shows an **Edit Scope** choice:
  - **"This session only"** → normal single-session update (`PUT /api/sessions/:id`).
  - **"This and all future sessions"** → `PUT /api/sessions/recurring/:groupId/future`. The anchor's date change is applied as a **day-shift + new time-of-day** to every still-active occurrence on/after the anchor.

### C. Cancel a recurring series
- Deleting a recurring session opens a dialog with:
  - **"Delete this only"** → single delete.
  - **"Cancel Series"** → `DELETE /api/sessions/recurring/:groupId` cancels all **upcoming** (scheduled/confirmed) occurrences.

---

## 3. Functional Requirements

| # | Requirement |
|---|-------------|
| FR1 | Support weekly recurrence with multiple weekdays and an interval of every 1–8 weeks. |
| FR2 | Support two end modes: fixed count (1–60) or an until-date. Exactly one must be provided. |
| FR3 | Expand the rule into concrete datetimes in the practice timezone (`America/New_York`), DST-safe. |
| FR4 | Preview must return each candidate date with a free/conflict flag and human-readable reason(s). |
| FR5 | Creation must skip conflicting dates and book the rest; if **all** conflict, return 409 and book nothing. |
| FR6 | Creation must be atomic and race-safe (no double-booking under concurrent requests). |
| FR7 | Every occurrence in a series shares one `recurrenceGroupId` of the form `rec-<UUID>`. |
| FR8 | Enforce safety caps: ≤60 sessions, ≤730 days horizon, business hours 8:00 AM–12:00 AM. |
| FR9 | "Edit this & all future" applies the anchor's edits (date-shift, time, room, service, therapist, type, notes, zoom) to all active future occurrences and re-checks conflicts. |
| FR10 | "Cancel series" cancels only upcoming (scheduled/confirmed) occurrences and clears their reminders. |
| FR11 | Send one combined series confirmation; schedule per-session reminders (no per-session confirmation). |
| FR12 | Optionally create a Zoom meeting per occurrence (best-effort; failures degrade gracefully). |
| FR13 | Audit-log each created session and each series edit/cancel for HIPAA compliance. |
| FR14 | Role gate edits: admin/administrator/supervisor/therapist; therapists may only edit their own sessions. |

---

## 4. Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React + Vite + TanStack Query)                    │
│   client/src/pages/scheduling.tsx                           │
│   - New Session wizard (Step 3 "Repeat weekly")            │
│   - buildRecurrenceRule(): assembles the rule payload      │
│   - recurrencePreviewMutation → /recurring/preview         │
│   - create/cancel/edit-future mutations                    │
└───────────────┬─────────────────────────────────────────────┘
                │ JSON over HTTP (apiRequest)
┌───────────────▼─────────────────────────────────────────────┐
│ Backend (Express + Drizzle ORM)                             │
│   server/routes.ts                                          │
│   Helpers:  checkTimeConflict, expandRecurrenceDates,      │
│             evaluateRecurrenceConflicts, acquireBookingLocks│
│   Routes:   POST   /api/sessions/recurring/preview         │
│             POST   /api/sessions/recurring                 │
│             PUT    /api/sessions/recurring/:groupId/future │
│             DELETE /api/sessions/recurring/:groupId        │
│   Services: storage.*, notificationService.*, zoomService.* │
│             AuditLogger.*                                   │
└───────────────┬─────────────────────────────────────────────┘
                │ Drizzle
┌───────────────▼─────────────────────────────────────────────┐
│ PostgreSQL (Neon)                                           │
│   sessions table (recurrenceGroupId + index)               │
│   pg_advisory_xact_lock for booking serialization          │
└─────────────────────────────────────────────────────────────┘
```

**Constants (server/routes.ts):**
- `RECURRENCE_PRACTICE_TZ = 'America/New_York'`
- `RECURRENCE_MAX_SESSIONS = 60`
- `RECURRENCE_MAX_DAYS = 730`
- Business hours: 8:00 AM – 12:00 AM practice time.

**Timezone handling:** all day-math is done on a UTC calendar cursor; wall-clock time is converted to UTC via `fromZonedTime(...)` / read back via `formatInTimeZone(...)` (from `date-fns-tz`) so DST shifts don't drift the appointment time.

---

## 5. Data Model (Schema / DB)

`shared/schema.ts` → `sessions` table (only recurrence-relevant fields shown; the table also has the normal single-session columns):

```ts
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id),
  therapistId: integer("therapist_id").notNull().references(() => users.id),
  serviceId: integer("service_id"),         // links to services (duration source)
  roomId: integer("room_id"),               // nullable
  sessionDate: timestamp("session_date").notNull(),   // stored in UTC
  sessionType: varchar("session_type", { length: 100 }).notNull(), // assessment|psychotherapy|consultation
  status: varchar("status", { length: 50 }).notNull().default("scheduled"),
  duration: integer("duration"),            // minutes (falls back to service.duration or 60)
  notes: text("notes"),
  zoomEnabled: boolean("zoom_enabled").default(false),
  zoomJoinUrl: text("zoom_join_url"),
  // --- RECURRENCE ---
  recurrenceGroupId: varchar("recurrence_group_id", { length: 64 }), // "rec-<UUID>", null for one-offs
}, (table) => ({
  recurrenceGroupIdIdx: index("sessions_recurrence_group_id_idx").on(table.recurrenceGroupId),
}));

export const insertSessionSchema = createInsertSchema(sessions).omit({ id: true, createdAt: true });
```

Related (separate feature, do not confuse): `therapist_blocked_times` has its own `isRecurring` (boolean) + `recurrencePattern` (text/JSON) for recurring availability blocks — **not** used for client sessions.

> **Key design decision:** recurrence is *materialized* (one row per occurrence) rather than stored as a rule + computed on read. This keeps reads simple, lets each occurrence be edited/cancelled independently, and makes calendar queries plain date-range scans. The trade-off: changing the whole series requires a bulk update (handled by the `/future` route).

---

## 6. API Design

### 6.1 `POST /api/sessions/recurring/preview`
Expand a rule and flag conflicts **without** saving.

**Request body** (`recurrenceRuleSchema`):
```jsonc
{
  "clientId": 12, "therapistId": 4, "serviceId": 7, "roomId": 2,   // roomId optional
  "sessionType": "psychotherapy",          // assessment | psychotherapy | consultation
  "notes": "…",                            // optional
  "zoomEnabled": false,                    // optional
  "startDate": "2026-06-10",               // yyyy-MM-dd (series start = first candidate week)
  "sessionTime": "14:00",                  // HH:mm (practice tz wall-clock)
  "daysOfWeek": [1, 3],                     // 0=Sun … 6=Sat, ≥1 day
  "interval": 1,                            // every N weeks, 1–8 (default 1)
  "endMode": "count",                      // "count" | "until"
  "count": 8,                               // required if endMode=count (1–60)
  "untilDate": "2026-08-31"                // required if endMode=until
}
```

**Response 200:**
```jsonc
{
  "sessions": [
    { "sessionDate": "2026-06-10T18:00:00.000Z", "localDate": "2026-06-10",
      "sessionTime": "14:00", "hasConflict": false, "reasons": [] },
    { "sessionDate": "2026-06-12T18:00:00.000Z", "localDate": "2026-06-12",
      "sessionTime": "14:00", "hasConflict": true, "reasons": ["Room is occupied"] }
  ],
  "totalRequested": 8, "freeCount": 7, "conflictCount": 1
}
```
Errors: `400` invalid rule (Zod), `401` unauth, `500` server.

### 6.2 `POST /api/sessions/recurring`
Create the series — book free dates, skip conflicts.

Same request body as preview. **Response 201:**
```jsonc
{
  "groupId": "rec-7b1f…",
  "created": [ /* full session rows */ ],
  "createdCount": 7,
  "skipped": [ { "sessionDate": "…Z", "reasons": ["Therapist is busy"] } ],
  "skippedCount": 1,
  "warning": "Zoom is not configured…"   // optional
}
```
Errors: `400` invalid rule / no dates produced / outside business hours, `409` **all** dates conflict (nothing booked), `401`, `500`.

### 6.3 `PUT /api/sessions/recurring/:groupId/future`
Edit "this and all future" occurrences.

**Request body:**
```jsonc
{
  "anchorId": 501,                 // the edited occurrence (must belong to groupId)
  "sessionDate": "2026-06-11T18:00:00.000Z",  // new anchor datetime → derives day-shift + new time
  "roomId": 3,                     // optional/nullable
  "notes": "…",                    // optional/nullable
  "serviceId": 7,                  // optional
  "therapistId": 4,                // optional
  "sessionType": "psychotherapy", // optional
  "zoomEnabled": true,             // optional
  "ignoreConflicts": false         // optional — bypass external-conflict check
}
```
**Behavior:** computes `dayDelta` and `newTimeOfDay` from anchor's original vs new date (DST-safe), shifts every active occurrence on/after the anchor's original date, re-checks conflicts against sessions **outside** the series, then bulk-updates and reschedules reminders.
Errors: `400` invalid series id / not part of series / outside business hours, `403` role/ownership, `404` anchor or future sessions missing.

### 6.4 `DELETE /api/sessions/recurring/:groupId`
Cancel all **upcoming** occurrences (status `scheduled` or `confirmed`) in the series and clear their reminders. Returns the count cancelled. Past/completed occurrences are untouched.

---

## 7. Code Design (helpers)

All in `server/routes.ts` (inside `registerRoutes`, so they close over `storage`, `db`, etc.):

- **`checkTimeConflict(newDate, durMin, existingDate, existingDurMin) → boolean`**
  Standard interval overlap: `newStart < existingEnd && newEnd > existingStart`.

- **`expandRecurrenceDates(rule) → { localDate, utcDate }[]`**
  Walks a UTC calendar cursor day-by-day from `startDate`; for each day checks (a) weekday ∈ `daysOfWeek` and (b) `weekIndex % interval === 0`; converts the local `sessionTime` to UTC via `fromZonedTime`. Stops at `count` / `untilDate` / 60-session cap / 730-day cap.

- **`evaluateRecurrenceConflicts(candidates, rule, durMin, includeHidden) → […, hasConflict, reasons]`**
  Loads existing sessions in the candidate date range once, filters to `scheduled|confirmed|in-progress`, then per candidate flags **"Therapist is busy"** and/or **"Room is occupied"** via `checkTimeConflict`.

- **`acquireBookingLocks(tx, therapistId, roomId)`**
  Takes `pg_advisory_xact_lock`(s) keyed on therapist (and room) inside the transaction so concurrent booking requests serialize and the in-transaction re-check sees committed rows. Locks release on commit.

External services used: `storage.getServiceById/getClient/getUser/getRooms/getSessionsWithFiltering/updateSession`, `notificationService.processEvent` + `sendSeriesScheduledConfirmation`, `zoomService.createMeeting`, `AuditLogger.logSessionAccess`.

---

## 8. Data Flow

### Create flow
```
Client wizard → buildRecurrenceRule() → POST /api/sessions/recurring
  → recurrenceRuleSchema.parse
  → expandRecurrenceDates(rule)                 // candidate datetimes
  → resolve service duration + name
  → business-hours guard (once, shared time)
  → evaluateRecurrenceConflicts()               // pre-check → free[] / skipped[]
  → if free == 0 → 409
  → groupId = "rec-" + UUID
  → db.transaction:
        acquireBookingLocks(therapist, room)
        re-read active sessions inside tx
        for each free candidate:
            re-check therapist/room overlap (race-safe)
            insert session row (recurrenceGroupId = groupId)
  → best-effort Zoom meeting per created session
  → AuditLogger.logSessionAccess per session
  → notificationService.processEvent('session_scheduled', …, {scheduledOnly:true})  // reminders only
  → notificationService.sendSeriesScheduledConfirmation(…)                          // ONE confirmation
  → 201 { groupId, created, skipped, … }
```

### Edit-future flow
```
PUT /recurring/:groupId/future
  → load anchor, verify anchor.recurrenceGroupId === groupId
  → futureSessions = series rows where date >= anchorOriginalDate AND status in (scheduled,confirmed)
  → dayDelta + newTimeOfDay (practice tz, DST-safe)
  → business-hours guard
  → recompute each occurrence's new UTC datetime (shift date + new time)
  → unless ignoreConflicts: conflict-check vs sessions OUTSIDE this series
  → bulk update rows (date/time/room/service/therapist/type/notes/zoom)
  → reschedule reminders; audit
```

---

## 9. Pseudocode

```text
function expandRecurrenceDates(rule):
    cursor   = UTC(startDate)
    startWk  = UTC(startDate)
    untilMs  = rule.untilDate ? UTC(untilDate) : null
    target   = rule.endMode == "count" ? rule.count : Infinity
    days     = set(rule.daysOfWeek)
    results  = []
    offset   = 0
    while results.len < target and results.len < 60 and offset <= 730:
        if untilMs != null and cursor > untilMs: break
        weekIndex = floor((cursor - startWk) / 7days)
        if cursor.weekday in days and weekIndex % rule.interval == 0:
            local = format(cursor, 'yyyy-MM-dd')
            utc   = fromZonedTime(local + ' ' + rule.sessionTime, PRACTICE_TZ)
            results.push({ local, utc })
        cursor += 1 day; offset += 1
    return results

function createSeries(rule):
    candidates = expandRecurrenceDates(rule)
    assert candidates not empty
    dur = serviceDuration(rule.serviceId) or 60
    assertBusinessHours(rule.sessionTime, dur)
    evaluated = evaluateConflicts(candidates, rule, dur)
    free = evaluated.filter(not conflict)
    if free empty: return 409
    groupId = "rec-" + uuid()
    transaction:
        acquireBookingLocks(rule.therapistId, rule.roomId)
        existing = activeSessionsInTx()
        for c in free:
            if overlaps(existing, c, rule.therapistId, rule.roomId): skip; continue
            insert session(c, groupId); existing.push(it)
    sendOneSeriesConfirmation(created)
    scheduleRemindersOnly(created)
    return { groupId, created, skipped }
```

---

## 10. Edge Cases

- **All dates conflict** → `409`, nothing booked, full skipped list returned.
- **Partial conflicts** → free dates booked, conflicts returned in `skipped[]`; UI shows both.
- **Race during creation** → in-tx re-check + advisory locks move a date that lost the race from `free` into `txSkipped`; never double-books.
- **Rule produces zero dates** (e.g. until-date before start, no matching weekday in range) → preview returns empty set; create returns `400`.
- **Caps hit** → silently stops at 60 sessions or 730 days; `count` is also Zod-capped at 60.
- **DST boundary** → wall-clock time preserved because conversions go through the practice timezone, not raw UTC offsets.
- **Outside business hours** (start ≥ 24:00 or end > 24:00 practice time) → `400`.
- **Edit-future with no upcoming sessions** → `404`.
- **Anchor not in series** → `400` "Session is not part of this series".
- **Therapist editing others' sessions** → `403`.
- **Zoom not configured / Zoom API fails** → booking still succeeds; `warning` returned, no link created.
- **Cancel series** only affects `scheduled`/`confirmed` future rows; completed/cancelled/past rows untouched.
- **Notifications fail** → wrapped in try/catch; booking is not rolled back (best-effort, errors logged).

---

## 11. Rebuild Instructions

1. **Schema:** add `recurrenceGroupId varchar(64)` (nullable) to the `sessions` table plus an index on it. Run `npm run db:generate` then `npm run db:push`. (Do **not** add a separate recurrence table.)
2. **Constants & helpers** in `server/routes.ts`: add `RECURRENCE_PRACTICE_TZ`, `RECURRENCE_MAX_SESSIONS=60`, `RECURRENCE_MAX_DAYS=730`; implement `checkTimeConflict`, `expandRecurrenceDates`, `evaluateRecurrenceConflicts`, `acquireBookingLocks`. Use `fromZonedTime`/`formatInTimeZone` from `date-fns-tz`.
3. **Validation:** define `recurrenceRuleSchema` (Zod) with the `.refine` that count↔untilDate matches `endMode`.
4. **Routes:** implement the four endpoints in §6 exactly (preview, create, edit-future, cancel-series). Wrap creation in `db.transaction` with advisory locks and an in-tx re-check.
5. **Notifications:** schedule per-session reminders with `{ scheduledOnly: true }` and send exactly **one** `sendSeriesScheduledConfirmation` for the series.
6. **Zoom (optional):** best-effort per-session meeting creation; never fail the booking on Zoom errors.
7. **Audit:** call `AuditLogger.logSessionAccess` per created session and for series edit/cancel.
8. **Frontend** (`client/src/pages/scheduling.tsx`): add repeat state (`repeatEnabled`, `repeatDays`, `repeatInterval`, `repeatEndMode`, `repeatCount`, `repeatUntil`), a `buildRecurrenceRule()` helper, the Step-3 "Repeat weekly" UI with a **Preview dates** button, an **Edit Scope** radio when `recurrenceGroupId` is present, and a delete dialog offering **Delete this only** vs **Cancel Series**. Use TanStack Query mutations + `apiRequest`, and invalidate the sessions query key after each mutation.
9. **Verify:** `npm run check` (typecheck), then manually create a 2-day weekly series with a deliberate conflict and confirm preview marks it, creation skips it, edit-future shifts dates, and cancel-series removes only upcoming occurrences.

---

## 12. AI Agent Rebuild Prompt

> Copy-paste this to an AI coding agent to rebuild the feature.

```
You are building a "weekly recurring sessions" feature in a full-stack TypeScript
therapy app (React + Vite + TanStack Query frontend; Express + Drizzle ORM +
PostgreSQL/Neon backend; date-fns-tz for timezones).

GOAL: Let a therapist/admin book a weekly recurring series of client appointments,
preview/skip conflicts, edit "this & all future", and cancel the whole series.

DATA MODEL: Do NOT add a recurrence table. Add one nullable column
`recurrenceGroupId varchar(64)` to the existing `sessions` table (+ an index).
Every occurrence in a series shares one id of the form `rec-<UUID>`. Recurrence is
MATERIALIZED: expand the rule into concrete session rows at creation; do not store
the rule.

CONSTANTS: practice timezone America/New_York; max 60 sessions/series; max 730-day
horizon; business hours 8:00 AM–12:00 AM practice time.

VALIDATION (Zod `recurrenceRuleSchema`): clientId, therapistId, serviceId (ints),
optional roomId, sessionType ∈ {assessment,psychotherapy,consultation}, optional
notes, optional zoomEnabled, startDate `yyyy-MM-dd`, sessionTime `HH:mm`,
daysOfWeek number[] 0–6 (≥1), interval 1–8 (default 1), endMode ∈ {count,until},
count 1–60, untilDate `yyyy-MM-dd`; refine: count required for "count" mode,
untilDate required for "until" mode.

HELPERS (backend): checkTimeConflict (interval overlap), expandRecurrenceDates
(UTC calendar cursor; filter by weekday and weekIndex % interval; convert local
time via fromZonedTime; respect caps), evaluateRecurrenceConflicts (load active
sessions in range once; flag "Therapist is busy" / "Room is occupied"),
acquireBookingLocks (pg_advisory_xact_lock per therapist+room inside the tx).

ROUTES:
- POST /api/sessions/recurring/preview  → expand + flag conflicts, return
  {sessions[], totalRequested, freeCount, conflictCount}. Save nothing.
- POST /api/sessions/recurring          → expand, business-hours guard, pre-check
  conflicts; if all conflict → 409; else db.transaction { acquireBookingLocks;
  re-read active sessions; per free date re-check race-safe then insert with
  recurrenceGroupId }; best-effort Zoom per session; audit per session; schedule
  reminders only (scheduledOnly:true); send ONE series confirmation; return
  {groupId, created, createdCount, skipped, skippedCount, warning?} 201.
- PUT /api/sessions/recurring/:groupId/future → body {anchorId, sessionDate, …};
  verify anchor∈series; select future active occurrences (date >= anchor original);
  compute DST-safe dayDelta + newTimeOfDay; business-hours guard; recompute each
  occurrence's datetime; conflict-check vs sessions OUTSIDE the series unless
  ignoreConflicts; bulk update; reschedule reminders; audit. Role-gate
  admin/supervisor/therapist; therapists only their own.
- DELETE /api/sessions/recurring/:groupId → cancel only upcoming
  (scheduled|confirmed) occurrences + clear their reminders; audit.

FRONTEND (scheduling page): in the New Session wizard step 3 add a "Repeat weekly"
toggle with day picker, interval select, end-mode (count|until) with count/until
inputs, and a "Preview dates" button that lists each date as Free/Conflict. Build
the rule with a buildRecurrenceRule() helper. When editing a session that has a
recurrenceGroupId, show an Edit Scope radio (this only | this & all future). Delete
dialog offers "Delete this only" vs "Cancel Series". Use TanStack Query mutations
with apiRequest and invalidate the sessions query key after each.

EDGE CASES to handle: all-conflict (409, book nothing), partial conflict (skip &
report), creation race (in-tx re-check + advisory lock), zero dates produced (400),
caps, DST, outside business hours (400), edit-future with no upcoming (404), anchor
not in series (400), therapist editing others (403), Zoom/notification failures
(best-effort, never roll back the booking).

Finally run the typecheck and verify a 2-day weekly series with a deliberate
conflict: preview marks it, create skips it, edit-future shifts dates, cancel-series
removes only upcoming occurrences.
```

---

### Source map (where to read the real implementation)
- Schema: `shared/schema.ts` (`sessions.recurrenceGroupId`, index)
- Helpers + routes: `server/routes.ts` (`checkTimeConflict`, `expandRecurrenceDates`, `evaluateRecurrenceConflicts`, `acquireBookingLocks`, the four `/api/sessions/recurring*` routes)
- Frontend: `client/src/pages/scheduling.tsx` (repeat state, `buildRecurrenceRule`, wizard step 3, edit-scope, delete/cancel dialog)

---
name: Quiet hours & weekend muting storage
description: Where account-wide notification delivery settings live and how delivery honors them
---

# Quiet hours / weekend muting

Quiet hours (`quietHoursStart`/`quietHoursEnd`) and weekend muting (`weekendsEnabled`)
are **account-wide**, not per-event. They are stored on ONE reserved
`notificationPreferences` row per user keyed by `triggerType = "__global__"`
(`GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER`, mirrored in client + server). Per-event
rows still carry these columns in the schema but delivery only reads the global row.

**Why:** the schema has the columns on every row, but the UX is a single window +
single weekend toggle. A reserved row avoids writing the same window onto every
per-trigger row and keeps the existing per-channel rows untouched. `"__global__"`
never collides with a real `notificationTriggers.eventType`, so it is invisible to
the per-trigger UI list and to the daily-digest lookup.

**How to apply:**
- Suppression is applied to EMAIL delivery only (the external "ping"), inside
  `sendEmailNotifications`. In-app notifications are still created so no record is
  lost when the user returns. Clients (role === "client") are never gated — they
  have no global row and must get transactional mail.
- Times are interpreted in `PRACTICE_TZ` ("America/New_York") via `toZonedTime`, so
  the window matches the therapist's local clock. Quiet windows may wrap midnight
  (22:00→08:00) — see `isWithinQuietWindow`.
- Quiet hours are "on" only when BOTH start and end are non-null. Toggling off sends
  `{quietHoursStart: null, quietHoursEnd: null}`. Stored as 'HH:MM:SS'; the time
  input uses 'HH:MM' (convert on save/load).
- The daily 8 AM schedule digest is intentionally NOT gated by quiet hours/weekends.

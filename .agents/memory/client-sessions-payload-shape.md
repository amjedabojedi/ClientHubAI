---
name: Client sessions payload shape & reschedule deep-link
description: /api/clients/:id/sessions returns nested relation objects (not flat names); scheduling reschedule has no get-by-id endpoint and must load the session's month.
---

## Session payload shape
`GET /api/clients/:clientId/sessions` (storage `getSessionsByClient`) returns each
session with **nested relation objects** — `therapist` (full user, via inner join),
`service`, `room` — and **no flat `therapistName`/`serviceName` field**.

**Why:** several `client-detail.tsx` spots read `session.therapistName`, which is
always `undefined` on this payload, so the session-details drawer rendered "with
Unknown Therapist" even though a therapist is always joined in.

**How to apply:** when displaying/passing the therapist for a session from this
endpoint, read `session.therapist?.fullName` / `session.therapist?.id` first.

## Scheduling reschedule deep-link
There is **no `GET /api/sessions/:id`** endpoint — only a month-scoped, access-scoped
list query `GET /api/sessions/:year/:month/month`. The scheduling page's
`editSessionId` URL param prefills the edit form **only if that session is in the
currently loaded month list**.

**Why:** the dashboard "Reschedule" action is the real consumer of `editSessionId`.
Navigating to bare `/scheduling` did nothing; and an upcoming session may live in a
future month the calendar isn't showing, so the lookup silently failed.

**How to apply:** reschedule links must pass both `editSessionId` AND `editDate`
(the session's date); scheduling jumps `selectedDate`/`currentMonth` to that month so
the month query loads the session before the prefill effect runs. Relying on the
month list means authz is enforced for free (a user can't prefill a session outside
their access scope). Always give a user-visible "not found" message when the session
isn't in the loaded target month, or the failure is invisible.

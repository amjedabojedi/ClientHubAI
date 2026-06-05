---
name: Client sessions payload shape
description: GET /api/clients/:clientId/sessions returns nested relation objects, not flat name fields — frontend must read session.therapist.fullName.
---

`GET /api/clients/:clientId/sessions` (storage `getSessionsByClient`) returns each
session with **nested relation objects** — `therapist` (full user, via inner join),
`service`, `room` — and **no flat `therapistName`/`serviceName` field**.

**Why:** several `client-detail.tsx` spots wrongly read `session.therapistName`,
which is always `undefined` on this payload, so the session-details drawer header
rendered "with Unknown Therapist" even though a therapist is always joined in.

**How to apply:** when displaying the therapist for a session that came from this
endpoint (list rows + the session-details slide-over header), read
`session.therapist?.fullName` (fall back to `therapistName` then a placeholder).
Note the reschedule-URL builders in the same file (scheduling links) still read the
nonexistent `therapistName`, so they prefill an empty therapist name — same latent
bug if those need fixing later.

---
name: admin role string mismatch
description: Single-role `=== 'administrator'` authz checks silently deny real admins because the DB role value is 'admin'.
---

Some authorization checks compare `req.user.role === 'administrator'` only. The actual
users.role values in this app are `therapist`, `accountant`, `admin`, `supervisor` — there is
**no** `administrator` value in the data. So an `'administrator'`-only check is *always false*
and silently denies real admins (403), unless another condition (e.g. assigned therapist) also
passes.

**Why:** Voice transcription / session-note finalize / unlock returned "You do not have
permission…" for admins even with AI consent granted, because those three checks used the
nonexistent `'administrator'` role. The user mistook it for an AI-consent problem.

**How to apply:** Admin checks must accept BOTH values: `role === 'administrator' || role === 'admin'`
(the dominant pattern in routes.ts; there is an `isAdminRole` helper too, but it's a `const`
defined mid-file so it's not in scope for earlier lines — inline the OR there). When debugging an
unexpected 403, grep for `=== 'administrator'` single-role checks; several isolated ones may still
remain elsewhere (e.g. Zoom credential status path).

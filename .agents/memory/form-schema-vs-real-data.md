---
name: Client form zod schemas must mirror real DB data, not the ideal
description: Why over-strict edit-form validation silently breaks saving, and the two guards that prevent it.
---

# Edit-form zod schemas must match what's actually in the DB

A react-hook-form `handleSubmit(onValid)` with **only** an onValid callback fails
**silently** when validation fails: the submit handler never runs, so no network
request fires and **no error is shown** — it looks exactly like "the button does
nothing." This is the #1 cause of "X edit isn't working" reports.

**Why this bites:** edit forms get pre-filled from existing rows via `reset()`. If
the schema is stricter than the data that already exists, real records can't pass
their own validation:
- A field marked required (`min(1)`) when the column is **nullable** and some rows
  are null (e.g. a session `room_id` for online/telehealth sessions).
- A `z.enum([...])` that lists only the "approved" values while the column is a
  free `varchar` holding legacy values (e.g. session_type had `online`,
  `in-person`, `individual` alongside the 3 expected ones).

**How to apply:**
1. Before trusting an edit-form schema, check the actual column type/nullability
   and the real value distribution (`SELECT col, count(*) ... GROUP BY col`). Make
   the schema **at least as permissive** as the data + the server validator
   (the server here uses `insertSessionSchema.partial()` over a `varchar(100)`
   session_type and a nullable room_id, so the client was the only thing rejecting).
   For optional numeric IDs use `z.preprocess(v => v===''||v==null ? undefined : v,
   z.coerce.number().int().min(1).optional())` — bare `z.coerce.number().optional()`
   turns `undefined` into `NaN` and still fails.
2. **Always pass the onInvalid arg**: `handleSubmit(onValid, (errors) => toast(...))`
   so a blocked save surfaces the first field error instead of doing nothing.

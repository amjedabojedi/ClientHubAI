---
name: Drizzle ANY(array) throws on neon driver
description: Why `sql\`x = ANY(${jsArray})\`` fails at runtime here and what to use instead.
---

# `= ANY(${jsArray})` throws with the neon serverless driver

Building a Drizzle `sql` fragment like `sql\`${users.id} = ANY(${someJsArray})\``
throws at execution time with:
`TypeError: The "string" argument must be of type string or an instance of
Buffer or ArrayBuffer. Received type number`.

The neon serverless driver does not bind a plain JS array into `ANY($1)` the way
node-postgres does.

**Use `inArray(col, jsArray)` from drizzle-orm instead** — it compiles to the
correct parameterized form and works.

**Why this matters:** the failure is silent in code paths that wrap the query in
a try/catch returning `[]` (e.g. `calculateRecipients` for the `specificUsers`
recipient rule in `server/notification-service.ts`). The query just yields zero
rows, so a notification trigger that targets specific users delivers to nobody
with no error surfaced.

**How to apply:** grep for `ANY(` in `sql\`...\`` fragments; any that interpolate
a JS array should be `inArray(...)`.

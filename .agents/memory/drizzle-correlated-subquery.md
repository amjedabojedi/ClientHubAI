---
name: Drizzle correlated subquery in select doesn't correlate
description: A sql`` correlated subquery referencing the outer table column in a .select() silently returns 0/wrong values on the neon driver.
---

A correlated subquery written as a select field, e.g.
`sql<number>\`(SELECT count(*) FROM ${childTable} c WHERE c.parent_id = ${parentTable.id})\``,
does **not** correlate to the outer row through Drizzle's `sql\`\`` interpolation — it silently returns 0 (or a constant), not an error. Typecheck passes; the bug only shows at runtime as wrong counts.

**Why:** the interpolated `${parentTable.id}` is rendered as a bare qualified column ref but the outer query's row scope isn't carried into the embedded subquery as expected by the driver.

**How to apply:** don't compute per-row child counts via a correlated `sql` subquery in `.select()`. Instead run a second grouped query — `select({ pid: child.parentId, n: count() }).from(child).where(inArray(child.parentId, ids)).groupBy(child.parentId)` — and join the counts in JS via a Map. Always verify aggregate/count values against real seeded data, never trust them from typecheck alone.

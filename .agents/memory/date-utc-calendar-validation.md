---
name: Date.UTC silently normalizes invalid calendar dates
description: Why YYYY-MM-DD regex validation is not enough before bucketing date ranges
---

`new Date(Date.UTC(y, mo-1, d))` does NOT reject impossible calendar dates — it
rolls them over: `2026-02-30` becomes Mar 2, day 31 in April becomes May 1,
month 13 becomes the next year. A regex-only `^\d{4}-\d{2}-\d{2}$` check passes
all of these.

**Why it matters:** date-range report endpoints (e.g. therapist period
statement) compute opening balance / earned / paid by bucketing rows into a
`[start, end)` window. A normalized-away date silently shifts the window, so the
API returns a 200 with the wrong period instead of a 400, and the user sees
numbers for dates they never asked for.

**How to apply:** after constructing the UTC date, round-trip it — verify
`dt.getUTCFullYear()/getUTCMonth()/getUTCDate()` equal the parsed input
components, and throw if they differ. Also enforce `end >= start`. Keep the
error message containing `startDate`/`endDate`/`YYYY` so the route's catch maps
it to a 400.

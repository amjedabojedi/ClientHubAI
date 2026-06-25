---
name: date-only timezone shift
description: date-only DB values (sessionDate) shift across month/day boundaries when parsed with new Date() in non-UTC zones.
---
Columns like `sessionDate` are date-only values that arrive at the client as ISO-ish strings (e.g. "2025-12-14" or "2025-12-14T00:00:00.000Z"). Parsing them with `new Date(d).toLocaleDateString()` reinterprets them in the browser's local timezone and can move them to the previous/next day — and therefore the previous/next month.

**Why:** This silently breaks anything that buckets or groups by month/day on the client (e.g. the Owed-tab month filter and per-category sums) — a row can display in one month but filter into another. Found via architect review of the therapist-payments Owed filter.

**How to apply:** For date-only values, derive both the display string AND any month/day bucket from the LITERAL calendar parts of the string (slice "YYYY-MM-DD", or construct `new Date(y, m-1, d)` with explicit components) — never from `new Date(isoString)`. Keep the display formatter and the bucket key on the same basis so they can't disagree.

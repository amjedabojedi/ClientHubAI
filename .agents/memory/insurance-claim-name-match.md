---
name: Insurance claim-line name matching
description: Why insurance statement lines fail to auto-match a session, and the subset rule that fixes it.
---

# Insurance claim-line auto-match: name-token subset rule

**Symptom:** an insurance statement claim line shows "No session matched" even
though the session clearly exists for that client/date.

**Root cause:** insurance statements carry the full legal name (middle name +
second surname, common in some cultures) while the app stores an abbreviated name
(first name + one surname). Requiring *every* statement name token to appear in the
stored name fails on the extra tokens.

**Rule:** treat names as compatible when one token set is a subset of the other
(`clientTokens ⊆ stmtTokens` OR `stmtTokens ⊆ clientTokens`). Pre-filter in SQL on
date + *any* shared token, then apply the subset check in JS.
**Why safe:** the single-candidate gate still forces ambiguity (≥2 survivors) to
manual, and auto-matches are only ever 'suggested' (never auto-posted) — a human
confirms before any insurance payment posts. Service-code disambiguation must run
on the name-narrowed candidates, not the raw rows.

**Normalization:** tokens are diacritic-stripped (NFD + remove combining marks),
lowercased, split on non-alphanumeric, len>=2 (`normalizedNameTokens` in
server/storage.ts). When a service date exists, the SQL prefilter is **date-only**
and ALL name logic runs in JS — an ILIKE name prefilter silently drops accented
stored names (token "jose" can't ILIKE-match stored "José").

**Partial tier:** when names only PARTLY overlap (share >=1 token but neither is a
full subset), AND a service date exists, AND exactly one candidate survives
date+serviceCode narrowing, it's suggested at `matchConfidence='partial'` (UI:
orange "Possible match · confirm"). Still never auto-posted; human confirms.
matchStatus/matchConfidence are varchar (not pg enums) so new confidence values
need no db:push.

**Saturation guard:** the candidate prefilter is capped (fetch CAP+1, CAP=50); if
more rows come back, additional valid candidates may be hidden so we bail to manual
rather than emit a misleading "unique" suggestion. Cap is applied BEFORE the
uniqueness gate, so don't trust uniqueness when saturated.

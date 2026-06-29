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

**Rule:** treat names as compatible when one token set is a *fuzzy* subset of the
other — every word-piece of the shorter name has a *similar* piece in the other
(`nameTokensSimilar`), order-independent. Pre-filter in SQL on date + *any* shared
token, then apply the subset check in JS.
**Why safe:** the single-candidate gate still forces ambiguity (≥2 survivors) to
manual, and auto-matches are only ever 'suggested' (never auto-posted) — a human
confirms before any insurance payment posts.

**nameTokensSimilar (fuzzy piece match):** equal OR truncation (shorter is a prefix
of longer, shorter len>=3 → "mohs"→"mohsen", "subh"→"subhi", "lutf"→"lutfi",
"german"→"germanica") OR transliteration (same first letter, editDistance<=2 for
len>=6 else <=1 → "ghonem"~"ghoneim", "mohamed"~"mohamad"). Kept conservative on
purpose: 2-letter fragments ("Mo") do NOT auto-bind (would fall to 'partial'), so a
short fragment can't latch onto a common surname. This correctly makes the ambiguous
Ghoneim pair (Ahmed Ghoneim vs Ahmed Mohsen…Ghonem) BOTH match → 2 candidates →
manual, which is the desired #9 "flag, don't merge" behavior.

**Service code is NOT used (owner directive):** matching is name-driven only. The
service DATE still narrows which sessions are candidates (structurally needed to pin
one billing), but service code no longer ranks/picks or boosts confidence. Removing
code-narrowing only sends MORE ambiguity to manual (safer), never less. Confidence:
fuzzy-subset name + date → 'high'; name only → 'medium'; partial overlap → 'partial'.

**Normalization:** tokens are diacritic-stripped (NFD + remove combining marks),
lowercased, split on non-alphanumeric, len>=2 (`normalizedNameTokens` in
server/storage.ts). When a service date exists, the SQL prefilter is **date-only**
and ALL name logic runs in JS — an ILIKE name prefilter silently drops accented
stored names (token "jose" can't ILIKE-match stored "José").

**Partial tier:** when names only PARTLY overlap (share >=1 token but neither is a
full subset), AND a service date exists, AND exactly one candidate survives the
date+name narrowing, it's suggested at `matchConfidence='partial'` (UI:
orange "Possible match · confirm"). Still never auto-posted; human confirms.
matchStatus/matchConfidence are varchar (not pg enums) so new confidence values
need no db:push.

**Saturation guard:** the candidate prefilter is capped (fetch CAP+1, CAP=50); if
more rows come back, additional valid candidates may be hidden so we bail to manual
rather than emit a misleading "unique" suggestion. Cap is applied BEFORE the
uniqueness gate, so don't trust uniqueness when saturated.

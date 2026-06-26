---
name: Insurance claim-line name matching
description: Why insurance statement lines fail to auto-match a session, and the subset rule that fixes it.
---

# Insurance claim-line auto-match: name-token subset rule

**Symptom:** an insurance statement claim line shows "No session matched" even
though the session clearly exists for that client/date.

**Root cause:** insurance statements carry the full legal name (second surname +
middle name, common in Hispanic names — e.g. "Rivas Fernandez Gerson Mar") while
SmartHub stores an abbreviated name ("Gerson Rivas"). Requiring *every* statement
name token to appear in the stored name fails on the extra tokens.

**Rule:** treat names as compatible when one token set is a subset of the other
(`clientTokens ⊆ stmtTokens` OR `stmtTokens ⊆ clientTokens`). Pre-filter in SQL on
date + *any* shared token, then apply the subset check in JS.
**Why safe:** the single-candidate gate still forces ambiguity (≥2 survivors) to
manual, and auto-matches are only ever 'suggested' (never auto-posted) — a human
confirms before any insurance payment posts. Service-code disambiguation must run
on the name-narrowed candidates, not the raw rows.

**Known gap:** tokenization is `/[a-z]{2,}/`, so accented/non-Latin names can still
under-match (false negatives). Needs Unicode-aware normalization to fully fix.

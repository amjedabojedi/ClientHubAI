---
name: External client privacy (two-initials rule)
description: How client identity must be reduced before it leaves SmartHub (feeds, emails, any external surface)
---

# External client privacy

Any client identity that LEAVES SmartHub (calendar feeds, emails, exports, any
external/3rd-party surface) must be reduced to TWO INITIALS ONLY (e.g. "J.D.").
Never the full name; never diagnosis, notes, or any clinical detail.

**Use `clientInitials(fullName)` from `shared/privacy.ts`** for all external
surfaces. It returns "J.D." (first+last initial), "M." for a single name, and
"C." for empty/missing (always initials-shaped, never free text).

**Do NOT confuse it with `formatClientInitial` in `server/routes.ts`** — that one
returns "John D." (full first name + last initial) and is an INTERNAL accountant
/ billing view only. It is NOT privacy-safe for anything leaving the system.

**Why:** SmartHub is a HIPAA-context therapy app; leaking PHI on an external
surface is the worst-case failure. Calendar feed (Task #37) and the daily 8AM
email (Task #38) both share this rule and should reuse `clientInitials`.

**How to apply:** When building/reviewing any feature that emits client data
off-platform, reduce the name through `clientInitials` at the boundary and make
sure no other client fields (diagnosis, session notes, service names) ride along.

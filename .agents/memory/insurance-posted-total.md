---
name: Insurance statement "posted total" vs line postedAmount
description: Why a posted insurance statement can show $0 settled, and which field means what.
---

# A posted insurance line's `postedAmount` is the net-new delta, not the settled total

On the insurance reconciliation page, two different numbers exist per posted line:

- **Settled / "Posted total"** = the line's full insurer-paid amount. This is what
  the statement actually settled and what the user expects to see. The backend post
  endpoint already returns its summary `postedTotal` as the sum of full insurer
  amounts.
- **`postedAmount` (stored on the line)** = only the NET-NEW amount added to the
  billing's cumulative insurance at post time. It exists so a later void can
  subtract *exactly* what posting added.

**The trap:** when the same insurance payment was already recorded MANUALLY before
posting, the post path "adopts" that manual transaction and adds nothing new, so
`postedAmount = 0` even though the statement genuinely settled the full amount. Any
UI/summary that sums `postedAmount` will therefore read **$0 for a fully settled
statement**. The "Posted total" tile must sum each posted line's full insurer-paid
amount, never `postedAmount`.

**Why:** `postedAmount` must stay the net-new delta for correct void reversal — do
not repurpose it for display. Keep the two concepts separate.

---
name: Payout pay-period labels
description: therapist_payouts period_start/end label the service window; reconciliation groups by exact label
---
- Payments stay on their real payment date; nullable period_start/period_end DATE cols only LABEL the service window covered. Server derives from covered sessions (items/allocations) in PRACTICE tz when omitted — client must NOT prefill by slicing ISO timestamps (UTC shift).
- therapist_earnings.earned_date is now the practice-timezone calendar date of the session (was UTC slice; historical rows corrected via SQL). Any bucketing (monthly report, period recon) relies on this.
- Period reconciliation ("Pay Periods" tab) buckets non-voided payouts by exact (start,end) label; overlapping labels double-count earnings, rows carry overlapsAnother flag instead of blocking.
- **Why:** owner pays weeks after the service month; without the label the running statement "mixes" months.
- **How to apply:** new payment paths must pass through validatePayPeriod (both-or-neither, real calendar dates) and invalidate the /api/therapist-pay/period-reconciliation query key.

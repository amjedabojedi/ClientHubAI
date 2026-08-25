# Statement #989 Billing Correction Record

**Completed:** 2026-08-25  
**Correction scope:** Five owner-approved session billing records posted by statement #989  
**Operational database:** The project’s provisioned development database. No published production database exists for this project.

## Approved outcome

The insurer’s $160.00 payment was confirmed as correct for each affected session.
The billing setup, rather than statement #989 or its payment transactions, was
corrected.

## Corrected billing records

| Billing ID | Service rate | Billing total | Discount | Expected amount | Insurance paid | Payment status | Ledger earning |
|---|---:|---:|---:|---:|---:|---|---:|
| 2447 | $160.00 | $160.00 | $0.00 | $160.00 | $160.00 | paid | $96.00 |
| 2540 | $160.00 | $160.00 | $0.00 | $160.00 | $160.00 | paid | $96.00 |
| 2594 | $160.00 | $160.00 | $0.00 | $160.00 | $160.00 | paid | $96.00 |
| 2681 | $160.00 | $160.00 | $0.00 | $160.00 | $160.00 | paid | $96.00 |
| 2761 | $160.00 | $160.00 | $0.00 | $160.00 | $160.00 | paid | $96.00 |

## Verification

- Each billing retains exactly one active $160.00 insurance payment sourced from
  statement #989.
- Each billing has a `billing_updated` audit entry describing the approved
  correction.
- The earnings ledger was re-synced for the affected therapist; each billing
  retains a $160.00 collected snapshot and $96.00 earned amount.
- The correction script was re-run after completion and made no billing changes,
  confirming its guarded, idempotent behavior.
- `npm run check` completed successfully after the correction.

## Scope boundary

A broader read-only reconciliation scan identified unrelated legacy records
whose insurance-paid amount exceeds their current net bill. Those records were
not changed because they require separate, statement-level review before any
financial correction is approved.
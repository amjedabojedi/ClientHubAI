// Single source of truth for the duplicate-insurance-payment safeguard.
//
// A manual insurance payment whose amount closely matches an insurance payment
// already posted from a statement (an EOB) is almost always the same money
// being re-keyed by hand, which would double-count collected insurance. Both
// the client-side advisory warning (see
// client/src/components/shared/duplicate-insurance-payment.tsx) and the
// server-side block (storage.recordPayment) must use the SAME tolerance, or the
// UI and the server can disagree — warning while the server allows, or
// rejecting a payment the UI never warned about. Keep the rule here so the two
// can never drift apart.
//
// Tolerance: a candidate amount is treated as a duplicate when it is within the
// greater of $1 or 5% of the already-posted amount.

export const DUPLICATE_INSURANCE_TOLERANCE_PCT = 0.05;
export const DUPLICATE_INSURANCE_MIN_TOLERANCE = 1;

/**
 * The absolute dollar tolerance for a given already-posted insurance amount:
 * the greater of the minimum ($1) or the percentage (5%) of that amount.
 */
export function duplicateInsuranceTolerance(postedAmount: number): number {
  return Math.max(
    DUPLICATE_INSURANCE_MIN_TOLERANCE,
    Math.abs(postedAmount) * DUPLICATE_INSURANCE_TOLERANCE_PCT,
  );
}

/**
 * Whether `candidateAmount` should be treated as a duplicate of an
 * already-posted insurance `postedAmount`.
 */
export function isDuplicateInsuranceAmount(
  candidateAmount: number,
  postedAmount: number,
): boolean {
  const posted = Math.abs(postedAmount);
  if (!(posted > 0)) return false;
  return Math.abs(candidateAmount - posted) <= duplicateInsuranceTolerance(posted);
}

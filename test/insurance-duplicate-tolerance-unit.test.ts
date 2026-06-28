/**
 * FAST UNIT test for the duplicate-insurance-payment tolerance MATH that lives
 * in shared/insurance.ts.
 *
 * Why this exists:
 *   The duplicate-insurance-payment tolerance — "within the greater of $1 or 5%
 *   of the already-posted amount" — is the single source of truth shared by BOTH
 *   the on-screen advisory warning (the useDuplicateInsurancePayment hook) and
 *   the server-side block (storage.recordPayment). There IS an end-to-end server
 *   guard test (test/insurance-duplicate-payment-server-guard.test.ts) that
 *   exercises the rule through the database, but it is slow and DB-backed and
 *   does not cheaply pin the EXACT boundary math. This suite pins that math
 *   directly so any future change to the rule (the $1 floor, the 5% slope, or
 *   the <= boundary) is caught immediately, with no database and no server.
 *
 * What it asserts (the tolerance contract):
 *   1. duplicateInsuranceTolerance: small posted amounts use the $1 floor; large
 *      posted amounts use 5% of the amount; the crossover is at exactly $20.
 *   2. isDuplicateInsuranceAmount: amounts just INSIDE the tolerance are flagged
 *      and amounts just OUTSIDE are not — for both the floor regime (small) and
 *      the percentage regime (large), and on both sides of the posted amount.
 *   3. Edge cases: an exact match is a duplicate; a zero/negative posted amount
 *      is never a duplicate; the comparison uses absolute magnitudes.
 *
 * Run with: npx tsx test/insurance-duplicate-tolerance-unit.test.ts
 *
 * No database, no server, no DOM — a pure import of the shared module.
 */

import {
  DUPLICATE_INSURANCE_TOLERANCE_PCT,
  DUPLICATE_INSURANCE_MIN_TOLERANCE,
  duplicateInsuranceTolerance,
  isDuplicateInsuranceAmount,
} from "../shared/insurance";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

function assertClose(actual: number, expected: number, message: string) {
  if (Math.abs(actual - expected) < 1e-9) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    console.error(`   Expected: ${expected}`);
    console.error(`   Actual:   ${actual}`);
    testsFailed++;
  }
}

// ---------------------------------------------------------------------------
function main() {
  // --- Sanity: the constants are the documented values --------------------
  assertClose(
    DUPLICATE_INSURANCE_TOLERANCE_PCT,
    0.05,
    "tolerance percentage constant is 5%",
  );
  assertClose(
    DUPLICATE_INSURANCE_MIN_TOLERANCE,
    1,
    "minimum tolerance floor constant is $1",
  );

  // --- duplicateInsuranceTolerance: floor vs percentage regimes -----------
  // Below the crossover, the $1 floor dominates (5% of the amount < $1).
  assertClose(
    duplicateInsuranceTolerance(10),
    1,
    "small amount ($10): tolerance is the $1 floor (5% = $0.50 < $1)",
  );
  assertClose(
    duplicateInsuranceTolerance(0.5),
    1,
    "tiny amount ($0.50): tolerance is still the $1 floor",
  );
  // The crossover is exactly $20: 5% of $20 == $1 == the floor.
  assertClose(
    duplicateInsuranceTolerance(20),
    1,
    "crossover amount ($20): 5% ($1) equals the floor ($1)",
  );
  // Above the crossover, 5% dominates.
  assertClose(
    duplicateInsuranceTolerance(100),
    5,
    "large amount ($100): tolerance is 5% = $5 (above the $1 floor)",
  );
  assertClose(
    duplicateInsuranceTolerance(1000),
    50,
    "large amount ($1000): tolerance is 5% = $50",
  );
  // Magnitude is used, so a negative posted amount yields the same tolerance.
  assertClose(
    duplicateInsuranceTolerance(-100),
    5,
    "negative amount (-$100): tolerance uses magnitude => $5",
  );

  // --- isDuplicateInsuranceAmount: the $1-floor regime (small amounts) ----
  // Posted $10 => tolerance $1. Inside/outside boundaries on both sides.
  assert(
    isDuplicateInsuranceAmount(10, 10),
    "small: exact match ($10 vs $10) is a duplicate",
  );
  assert(
    isDuplicateInsuranceAmount(11, 10),
    "small: $11 vs $10 is exactly on the $1 boundary => duplicate (<=)",
  );
  assert(
    isDuplicateInsuranceAmount(9, 10),
    "small: $9 vs $10 is exactly on the $1 boundary (below) => duplicate",
  );
  assert(
    isDuplicateInsuranceAmount(10.99, 10),
    "small: $10.99 vs $10 is just inside the $1 floor => duplicate",
  );
  assert(
    !isDuplicateInsuranceAmount(11.01, 10),
    "small: $11.01 vs $10 is just outside the $1 floor => NOT duplicate",
  );
  assert(
    !isDuplicateInsuranceAmount(8.99, 10),
    "small: $8.99 vs $10 is just outside the $1 floor (below) => NOT duplicate",
  );

  // --- isDuplicateInsuranceAmount: the 5% regime (large amounts) ----------
  // Posted $100 => tolerance $5. Inside/outside boundaries on both sides.
  assert(
    isDuplicateInsuranceAmount(100, 100),
    "large: exact match ($100 vs $100) is a duplicate",
  );
  assert(
    isDuplicateInsuranceAmount(105, 100),
    "large: $105 vs $100 is exactly on the 5% boundary => duplicate (<=)",
  );
  assert(
    isDuplicateInsuranceAmount(95, 100),
    "large: $95 vs $100 is exactly on the 5% boundary (below) => duplicate",
  );
  assert(
    isDuplicateInsuranceAmount(104.99, 100),
    "large: $104.99 vs $100 is just inside the 5% band => duplicate",
  );
  assert(
    !isDuplicateInsuranceAmount(105.01, 100),
    "large: $105.01 vs $100 is just outside the 5% band => NOT duplicate",
  );
  assert(
    !isDuplicateInsuranceAmount(94.99, 100),
    "large: $94.99 vs $100 is just outside the 5% band (below) => NOT duplicate",
  );
  // A genuinely different top-up is far outside the band and never flagged.
  assert(
    !isDuplicateInsuranceAmount(50, 100),
    "large: $50 vs $100 (a real, different payment) is NOT a duplicate",
  );

  // --- Edge cases ----------------------------------------------------------
  assert(
    !isDuplicateInsuranceAmount(0.5, 0),
    "zero posted amount is never a duplicate (nothing to match against)",
  );
  assert(
    !isDuplicateInsuranceAmount(0, 0),
    "zero vs zero is never a duplicate (no posted amount)",
  );
  assert(
    !isDuplicateInsuranceAmount(5, -100),
    "negative posted amount: $5 is far from magnitude $100 => NOT duplicate",
  );
  assert(
    isDuplicateInsuranceAmount(98, -100),
    "negative posted amount: $98 within 5% of magnitude $100 => duplicate",
  );

  // ---------------------------------------------------------------------------
  console.log("\n" + "=".repeat(50));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(50));
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📈 Total:  ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log("\n🎉 All tests passed!");
    process.exit(0);
  } else {
    console.log("\n⚠️  Some tests failed.");
    process.exit(1);
  }
}

main();

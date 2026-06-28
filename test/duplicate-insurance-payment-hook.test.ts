/**
 * DIRECT UNIT test for the shared duplicate-insurance-payment HOOK
 * (useDuplicateInsurancePayment in
 * client/src/components/shared/duplicate-insurance-payment.tsx).
 *
 * Why this exists:
 *   The advisory that warns staff when they re-key an insurance payment already
 *   posted from an uploaded statement (an EOB) lives in ONE shared hook consumed
 *   by BOTH the Billing Dashboard PaymentDialog and the client profile "Record
 *   Payment" mini-form. The browser-level
 *   test/insurance-duplicate-payment-warning-ui.test.ts proves the warning wires
 *   up end-to-end on ONE surface, but it cannot cheaply pin down the matching
 *   MATH itself (tolerance edges, the insurance-only gate, which transactions
 *   even count). This suite exercises the hook directly so a future refactor of
 *   the shared matching logic can't silently weaken the safeguard on both
 *   surfaces at once.
 *
 * What it asserts (the hook's contract):
 *   1. A matching insurance amount WITHIN tolerance (~5% / $1) yields a
 *      duplicateStatementMatch (exact match AND the high/low tolerance edges).
 *   2. An amount OUTSIDE tolerance yields NO match (genuine, different top-ups
 *      are not flagged — the whole point of the tight tolerance).
 *   3. A NON-insurance payment (isInsurancePayment=false) yields NO match, even
 *      when the amount matches a posted statement exactly.
 *   4. Only real posted-statement insurance txns count: voided txns, non-
 *      insurance txns, txns without a sourceStatementId, and zero/negative
 *      amounts are all excluded from postedStatementInsuranceTxns.
 *   5. The $1 MINIMUM tolerance floor applies for small statement amounts.
 *
 * The hook uses useMemo, so it must run inside a React render. We mount a tiny
 * probe component into a jsdom DOM with react-dom/client and read back the
 * hook's result after each render. No database, no server, no network.
 *
 * Run with: npx tsx test/duplicate-insurance-payment-hook.test.ts
 */

import { JSDOM } from "jsdom";

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

function assertEqual(actual: any, expected: any, message: string) {
  if (actual === expected) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    console.error(`   Expected: ${JSON.stringify(expected)}`);
    console.error(`   Actual:   ${JSON.stringify(actual)}`);
    testsFailed++;
  }
}

// ---------------------------------------------------------------------------
async function main() {
  // --- jsdom browser environment (must be set before importing react-dom) ---
  const dom = new JSDOM(
    "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/", pretendToBeVisual: true },
  );
  const g = global as any;
  g.window = dom.window;
  g.document = dom.window.document;
  g.navigator = dom.window.navigator;
  g.HTMLElement = dom.window.HTMLElement;
  g.Node = dom.window.Node;
  g.Element = dom.window.Element;
  g.requestAnimationFrame =
    dom.window.requestAnimationFrame ||
    ((cb: any) => setTimeout(() => cb(Date.now()), 0));
  g.cancelAnimationFrame =
    dom.window.cancelAnimationFrame || ((id: any) => clearTimeout(id));
  g.IS_REACT_ACT_ENVIRONMENT = true;

  // --- Dynamic imports (after jsdom globals exist) --------------------------
  const React = (await import("react")).default;
  // The shared TSX is transpiled with the classic JSX runtime and does not
  // import React itself (it renders JSX in DuplicateInsuranceWarning), so expose
  // it as a global before importing the module.
  g.React = React;
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useDuplicateInsurancePayment } = await import(
    "../client/src/components/shared/duplicate-insurance-payment"
  );

  // A probe component that calls the hook and writes the latest result into a
  // shared holder, so we can re-render with different props and inspect the
  // returned match/filtered list.
  let latest: ReturnType<typeof useDuplicateInsurancePayment> | null = null;
  function Probe(props: {
    transactions: any[] | undefined;
    amount: number;
    isInsurancePayment: boolean;
  }) {
    latest = useDuplicateInsurancePayment(props);
    return null;
  }

  const root = createRoot(dom.window.document.getElementById("root")!);

  async function evaluate(props: {
    transactions: any[] | undefined;
    amount: number;
    isInsurancePayment: boolean;
  }) {
    await act(async () => {
      root.render(React.createElement(Probe, props));
    });
    return latest!;
  }

  try {
    // A realistic posted-statement insurance transaction: $100 recorded from an
    // EOB (carries source="insurance" + a sourceStatementId), plus some noise
    // rows that must NOT count.
    const postedTxns = [
      {
        amount: "100.00",
        source: "insurance",
        sourceStatementId: 7,
        statementPayerName: "Acme Health",
        statementCheckNumber: "CHK-1",
      },
      // Manual client payment — not insurance, must be ignored.
      { amount: "100.00", source: "client", sourceStatementId: null },
      // Insurance but with no statement linkage (a manual insurance entry) —
      // must be ignored: the warning is specifically about STATEMENT duplicates.
      { amount: "100.00", source: "insurance", sourceStatementId: null },
      // A voided statement insurance txn — must be ignored.
      {
        amount: "100.00",
        source: "insurance",
        sourceStatementId: 9,
        voidedAt: new Date().toISOString(),
      },
      // A zero-amount statement insurance txn — must be ignored.
      { amount: "0.00", source: "insurance", sourceStatementId: 11 },
    ];

    // === 4. Only real posted-statement insurance txns are counted ============
    let r = await evaluate({
      transactions: postedTxns,
      amount: 100,
      isInsurancePayment: true,
    });
    assertEqual(
      r.postedStatementInsuranceTxns.length,
      1,
      "Only the single real posted-statement insurance txn counts (client/manual/voided/zero excluded)",
    );
    assertEqual(
      r.postedStatementInsuranceTxns[0]?.sourceStatementId,
      7,
      "The counted posted txn is the $100 statement #7 line",
    );

    // === 1. Matching insurance amount WITHIN tolerance → match ===============
    // Exact match.
    assert(
      r.duplicateStatementMatch?.sourceStatementId === 7,
      "Exact $100 insurance amount matches the posted $100 statement (duplicateStatementMatch set)",
    );

    // tol for $100 = max($1, 5% * 100) = $5. $104 is within → still a match.
    r = await evaluate({
      transactions: postedTxns,
      amount: 104,
      isInsurancePayment: true,
    });
    assert(
      r.duplicateStatementMatch?.sourceStatementId === 7,
      "An amount at the high tolerance edge ($104 vs $100, tol $5) is flagged as a duplicate",
    );

    // $96 is within the $5 tolerance on the low side → match.
    r = await evaluate({
      transactions: postedTxns,
      amount: 96,
      isInsurancePayment: true,
    });
    assert(
      r.duplicateStatementMatch?.sourceStatementId === 7,
      "An amount at the low tolerance edge ($96 vs $100, tol $5) is flagged as a duplicate",
    );

    // === 2. Amount OUTSIDE tolerance → NO match ==============================
    r = await evaluate({
      transactions: postedTxns,
      amount: 106,
      isInsurancePayment: true,
    });
    assertEqual(
      r.duplicateStatementMatch,
      null,
      "An amount outside tolerance ($106 vs $100, tol $5) is NOT flagged (genuine different payment)",
    );

    r = await evaluate({
      transactions: postedTxns,
      amount: 50,
      isInsurancePayment: true,
    });
    assertEqual(
      r.duplicateStatementMatch,
      null,
      "A clearly different top-up amount ($50 vs $100) is NOT flagged",
    );

    // === 3. NON-insurance payment → NO match (even on an exact amount) =======
    r = await evaluate({
      transactions: postedTxns,
      amount: 100,
      isInsurancePayment: false,
    });
    assertEqual(
      r.duplicateStatementMatch,
      null,
      "A non-insurance payment of the exact same $100 is NOT flagged (isInsurancePayment gate)",
    );

    // A zero/blank amount never matches even when flagged as insurance.
    r = await evaluate({
      transactions: postedTxns,
      amount: 0,
      isInsurancePayment: true,
    });
    assertEqual(
      r.duplicateStatementMatch,
      null,
      "A zero amount is never flagged as a duplicate",
    );

    // === 5. The $1 MINIMUM tolerance floor for small statement amounts =======
    // For a $10 statement, 5% = $0.50 which is below the $1 floor, so tol = $1.
    const smallTxns = [
      { amount: "10.00", source: "insurance", sourceStatementId: 21 },
    ];
    r = await evaluate({
      transactions: smallTxns,
      amount: 11,
      isInsurancePayment: true,
    });
    assert(
      r.duplicateStatementMatch?.sourceStatementId === 21,
      "$11 vs a $10 statement is within the $1 minimum tolerance floor → flagged",
    );
    r = await evaluate({
      transactions: smallTxns,
      amount: 12,
      isInsurancePayment: true,
    });
    assertEqual(
      r.duplicateStatementMatch,
      null,
      "$12 vs a $10 statement is beyond the $1 floor → NOT flagged",
    );

    // === No transactions at all → nothing to match ==========================
    r = await evaluate({
      transactions: undefined,
      amount: 100,
      isInsurancePayment: true,
    });
    assertEqual(
      r.postedStatementInsuranceTxns.length,
      0,
      "Undefined transactions yields an empty posted list (no crash)",
    );
    assertEqual(
      r.duplicateStatementMatch,
      null,
      "With no transactions there is no duplicate match",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    await act(async () => {
      root.unmount();
    });
  }

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

main().catch((error) => {
  console.error("Fatal error running tests:", error);
  process.exit(1);
});

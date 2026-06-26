/**
 * BROWSER-LEVEL test that re-uploading a DUPLICATE insurance statement AFTER a
 * corrected payout has been recorded never re-inflates what the therapist is
 * owed and never generates a second over-payment.
 *
 * This closes the last gap left by the sibling suites of the SAME scenario:
 *   - test/insurance-void-repost-corrects-pay.test.ts proves at the STORAGE
 *     layer that the void → re-open → re-post cleanup self-corrects earnings.
 *   - test/insurance-repost-doublecount-ui.test.ts proves the collected
 *     insurance lands on the single $100 at the BROWSER layer.
 *   - test/therapist-owed-corrected-pay-ui.test.ts proves the Owed tab DISPLAYS
 *     the corrected $50.
 *   - test/therapist-owed-record-payout-amount-ui.test.ts proves RECORDING the
 *     payout writes the corrected $50 and drops owed to $0.
 *
 * THIS suite goes one step further: it pays the corrected $50, THEN simulates
 * staff (or an automated EOB importer) re-uploading the SAME statement a second
 * time. The double-count guard (additional = max(0, lineAmount -
 * billing.insurancePaidAmount)) plus the over-payment credit are supposed to
 * make that duplicate a no-op for the ledger. There was no end-to-end proof of
 * this: a regression in the guard could re-add the $100 to collected, re-inflate
 * earned to $100, and resurrect the already-paid session on the owed list — so
 * the therapist would be paid a SECOND time for the same money. This test proves
 * that does NOT happen.
 *
 * What it does (in order):
 *   1. Seeds a session/billing with a 50% pay rule, posts a $100 statement, then
 *      MANUALLY keys the same $100 again so collected inflates to $200 (the
 *      classic double-count).
 *   2. Materializes the INFLATED earning by reading the therapist statement once.
 *   3. CLEANS UP operationally (void → re-open → re-post). Collected lands back
 *      on the single $100; earned corrects to $50.
 *   4. Loads /therapist-payments as a billing user, opens the Owed tab, ticks the
 *      session, records the corrected $50 payout, and confirms owed falls to $0.
 *   5. THE NEW PART: re-uploads a brand-new DUPLICATE statement for the same
 *      billing/payment and posts it. Then asserts, at BOTH layers:
 *        - storage: billing.insurancePaidAmount is STILL $100 (no re-inflation),
 *          getTherapistOwed total is $0 with no row for the session, and exactly
 *          ONE payout exists for the therapist (no extra over-payment),
 *        - browser: reloading the Owed tab still shows the session GONE and the
 *          "Total currently owed" header card still reads $0.00.
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper.
 * The app is spawned as a real dev server on an ephemeral port.
 *
 * Run with: npx tsx test/therapist-owed-duplicate-restatement-no-reinflate-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named rows and removes them (and
 *   anything derived — including the created payout and BOTH statements) in a
 *   finally block.
 * - Must run serially with the other app-level tests (shared dev DB races on
 *   generated identifiers when run concurrently — see
 *   .agents/memory/privacy-test-concurrency.md). Chained into `test-privacy`.
 * - See .agents/memory/browser-tests-puppeteer.md for the auth + Radix patterns.
 */

import type { Browser, Page } from "puppeteer";
import {
  startDevServer,
  launchBrowser,
  loginAs,
  type DevServer,
} from "./helpers/browser";
import { db } from "../server/db";
import { storage } from "../server/storage";
import {
  users,
  clients,
  services,
  sessions,
  sessionBilling,
  therapistPayRules,
  therapistEarnings,
  therapistPayouts,
  therapistPayoutItems,
  auditLogs,
  insuranceStatements,
  insuranceStatementLines,
  paymentTransactions,
} from "../shared/schema";
import { and, eq, inArray } from "drizzle-orm";

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

const SUFFIX = `thr-owed-dup-restmt-noreinflate-ui-${Date.now()}`;

// Radix Tabs only mount the ACTIVE tab's content and require a TRUSTED event to
// switch — a synthetic DOM .click() will not change the tab. Drive a real
// ElementHandle click. See .agents/memory/browser-tests-puppeteer.md.
async function clickTabById(page: Page, testId: string) {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  const handle = await page.$(selector);
  if (!handle) throw new Error(`tab ${testId} not found`);
  await handle.evaluate((el: Element) =>
    el.scrollIntoView({ block: "center", inline: "center" }),
  );
  await handle.click();
}

// Click any element by testid with a TRUSTED ElementHandle click (Radix
// checkboxes / portaled dialog buttons need a real click, not a synthetic one).
async function clickById(page: Page, testId: string) {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  const handle = await page.$(selector);
  if (!handle) throw new Error(`element ${testId} not found`);
  await handle.evaluate((el: Element) =>
    el.scrollIntoView({ block: "center", inline: "center" }),
  );
  await handle.click();
}

async function getBilling(billingId: number) {
  const [b] = await db
    .select()
    .from(sessionBilling)
    .where(eq(sessionBilling.id, billingId))
    .limit(1);
  return b;
}

// Pick the therapist in the Radix Popover + cmdk search, then open the Owed tab
// and wait for the live GET /owed recompute to land. Used twice: once before the
// payout and once after the duplicate re-upload (to prove no re-inflation).
async function openOwedTab(page: Page, baseUrl: string, therapistId: number) {
  await page.goto(`${baseUrl}/therapist-payments`, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForSelector('[data-testid="select-therapist"]:not([disabled])', {
    timeout: 30_000,
  });
  await page.click('[data-testid="select-therapist"]');
  await page.waitForSelector('[data-testid="input-therapist-search"]', {
    timeout: 30_000,
  });
  await page.type('[data-testid="input-therapist-search"]', SUFFIX);
  await page.waitForSelector(`[data-testid="option-therapist-${therapistId}"]`, {
    timeout: 30_000,
  });
  await page.click(`[data-testid="option-therapist-${therapistId}"]`);

  const [owedResp] = await Promise.all([
    page.waitForResponse(
      (res: any) =>
        res.url().includes(`/api/therapist-pay/owed/${therapistId}`) &&
        res.request().method() === "GET",
      { timeout: 45_000 },
    ),
    clickTabById(page, "tab-owed"),
  ]);
  return owedResp;
}

// ---------------------------------------------------------------------------
async function main() {
  let therapistId: number | undefined;
  let billingUserId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  let billingId: number | undefined;
  let statementId: number | undefined;
  let lineId: number | undefined;
  // The second, DUPLICATE statement uploaded after the payout.
  let dupStatementId: number | undefined;
  let dupLineId: number | undefined;

  let devServer: DevServer | null = null;
  let browser: Browser | null = null;

  try {
    // --- Seed therapist, billing actor, client, service, session, billing ---
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    // A billing-role user can reach /therapist-payments and its routes.
    const billingUser = await storage.createUser({
      username: `billing-${SUFFIX}`,
      password: "x",
      fullName: `Billing ${SUFFIX}`,
      email: `billing-${SUFFIX}@example.test`,
      role: "billing",
    } as any);
    billingUserId = billingUser.id;

    // Insert the client directly with an explicit, unique clientId. We avoid
    // storage.createClient because it derives a sequential CL-YEAR-NNNN id from
    // MAX+1, which races against other suites running concurrently.
    const [client] = await db
      .insert(clients)
      .values({
        clientId: `T${Date.now()}`.slice(0, 20),
        fullName: `Client ${SUFFIX}`,
        assignedTherapistId: therapistId,
      } as any)
      .returning();
    clientId = client.id;

    const [service] = await db
      .insert(services)
      .values({
        serviceCode: `SVC-${SUFFIX}`.slice(0, 50),
        serviceName: `Test Service ${SUFFIX}`,
        duration: 60,
        baseRate: "100.00",
      })
      .returning();
    serviceId = service.id;

    const [session] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId,
        serviceId,
        sessionDate: new Date("2026-04-12T10:00:00.000Z"),
        sessionType: "individual",
        status: "completed",
      })
      .returning();
    sessionId = session.id;

    const [billing] = await db
      .insert(sessionBilling)
      .values({
        sessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "100.00",
        totalAmount: "100.00",
        clientPaidAmount: "0.00",
        insurancePaidAmount: "0.00",
        billingDate: "2026-04-12",
        paymentStatus: "pending",
      })
      .returning();
    billingId = billing.id;

    // Default percentage pay rule: 50% of collected.
    await db.insert(therapistPayRules).values({
      therapistId,
      serviceId: null,
      payType: "percentage",
      payValue: "50.00",
    });

    // --- 1. Build the over-collected ($200) double-count state -------------
    const stmt = await storage.createInsuranceStatement(
      {
        fileName: `stmt-${SUFFIX}.pdf`,
        sourceType: "pdf",
        payerName: `Test Payer ${SUFFIX}`,
        statementDate: "2026-04-15",
        status: "draft",
      } as any,
      [
        {
          clientNameRaw: `Client ${SUFFIX}`,
          serviceCode: `SVC-${SUFFIX}`.slice(0, 50),
          insurancePaidAmount: "100.00",
        } as any,
      ],
    );
    statementId = stmt.id;

    const [createdLine] = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.statementId, stmt.id))
      .limit(1);
    lineId = createdLine.id;

    await storage.updateStatementLineMatch(lineId, {
      matchStatus: "confirmed",
      matchedSessionBillingId: billingId,
    });
    await storage.postInsuranceStatement(statementId, billingUserId);

    let b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "After posting the statement, collected insurance is the real $100",
    );

    // Staff, not realizing the EOB was already posted, MANUALLY key the same
    // $100 again. recordPayment's amount is the new CUMULATIVE for the source,
    // so 200 means "add another $100 manual row on top". collected → $200.
    await storage.recordPayment(billingId, {
      status: "billed",
      amount: 200,
      date: "2026-04-16",
      method: "insurance",
      source: "insurance",
      recordedBy: billingUserId,
      notes: "Manual insurance entry (duplicate of already-posted EOB)",
    } as any);

    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      200,
      "Stacking the manual $100 inflates collected insurance to $200 (double count)",
    );

    // --- 2. Materialize the INFLATED earning (single $100 earning row) -----
    const inflatedStatement = await storage.getTherapistStatement(therapistId);
    assertEqual(
      inflatedStatement.currentOwed,
      100,
      "Before cleanup the therapist statement is inflated: currentOwed is $100 (50% of $200)",
    );

    // --- 3. Clean up via the REAL operational flow (no raw column edit) ----
    await storage.voidInsuranceStatement(
      statementId,
      billingUserId,
      "duplicate EOB cleanup — duplicate re-upload no-reinflate check",
    );
    await storage.reopenInsuranceStatement(statementId, billingUserId);
    await storage.postInsuranceStatement(statementId, billingUserId);

    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "After void → re-open → re-post, collected is back on the correct single $100",
    );

    // --- 4. Browser flow: open the Owed tab and RECORD the corrected payout -
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;
    browser = await launchBrowser();

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await loginAs(page, {
      username: billingUser.username,
      password: "x",
    });
    assertEqual(loginStatus, 200, "Billing user logs in via /api/auth/login");

    const owedResp = await openOwedTab(page, baseUrl, therapistId);
    assertEqual(
      owedResp.status(),
      200,
      "Opening the Owed tab fires GET /owed that returns 200",
    );

    // Sanity: the row shows the corrected single $50 before we pay it out.
    const owedSelector = `[data-testid="text-owed-amount-${billingId}"]`;
    await page.waitForFunction(
      (sel: string) => {
        const el = document.querySelector(sel);
        return !!el && (el.textContent || "").trim() === "$50.00";
      },
      { timeout: 30_000 },
      owedSelector,
    );

    // Tick the session's checkbox. Radix Checkbox needs a TRUSTED click.
    await clickById(page, `checkbox-owed-${billingId}`);

    await page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-testid="button-record-payout"]',
        ) as HTMLButtonElement | null;
        return !!btn && !btn.disabled && (btn.textContent || "").includes("$50.00");
      },
      { timeout: 30_000 },
    );
    await clickById(page, "button-record-payout");

    await page.waitForSelector('[data-testid="button-confirm-payout"]', {
      timeout: 30_000,
    });

    const [payoutResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes("/api/therapist-pay/payouts") &&
          res.request().method() === "POST",
        { timeout: 45_000 },
      ),
      clickById(page, "button-confirm-payout"),
    ]);
    assertEqual(
      payoutResp.status(),
      201,
      "Confirming the payout fires POST /payouts that returns 201 Created",
    );

    const payoutBody = await payoutResp.json();
    assertEqual(
      String(payoutBody.totalAmount),
      "50.00",
      "The created payout's totalAmount is the corrected single $50",
    );
    const firstPayoutId = Number(payoutBody.id);

    // After payout the session drops off owed; total falls to $0.
    await page.waitForFunction(
      (sel: string) => !document.querySelector(sel),
      { timeout: 30_000 },
      owedSelector,
    );
    const totalOwedAfterPayout = await page.$eval(
      '[data-testid="text-total-owed"]',
      (el: Element) => (el.textContent || "").trim(),
    );
    assertEqual(
      totalOwedAfterPayout,
      "$0.00",
      "After the corrected payout the 'Total currently owed' header reads $0.00",
    );

    // --- 5. THE NEW PART: re-upload a DUPLICATE statement, then prove the ---
    //        owed amount does NOT re-inflate and no extra payout is owed.
    //
    // Simulate staff (or an automated EOB importer) uploading the SAME insurer
    // payment a SECOND time as a brand-new statement, matching it to the same
    // billing and posting it. The double-count guard must add $0 (the billing
    // already shows the single $100), so collected stays $100, earned stays
    // $50, and — since $50 was already paid — owed stays $0.
    const dupStmt = await storage.createInsuranceStatement(
      {
        fileName: `stmt-DUP-${SUFFIX}.pdf`,
        sourceType: "pdf",
        payerName: `Test Payer ${SUFFIX}`,
        statementDate: "2026-04-20",
        status: "draft",
      } as any,
      [
        {
          clientNameRaw: `Client ${SUFFIX}`,
          serviceCode: `SVC-${SUFFIX}`.slice(0, 50),
          insurancePaidAmount: "100.00",
        } as any,
      ],
    );
    dupStatementId = dupStmt.id;

    const [dupCreatedLine] = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.statementId, dupStmt.id))
      .limit(1);
    dupLineId = dupCreatedLine.id;

    await storage.updateStatementLineMatch(dupLineId, {
      matchStatus: "confirmed",
      matchedSessionBillingId: billingId,
    });
    const dupPost = await storage.postInsuranceStatement(
      dupStatementId,
      billingUserId,
    );

    // The guard posts a $0 shortfall for the duplicate line.
    const [dupLineAfter] = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.id, dupLineId))
      .limit(1);
    assertEqual(
      Number(dupLineAfter.postedAmount),
      0,
      "The duplicate statement posts a $0 shortfall (guard adds nothing new)",
    );

    // Storage proof #1: collected insurance is STILL the single $100.
    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "After re-uploading the duplicate statement, collected insurance is STILL $100 (no re-inflation)",
    );

    // Storage proof #2: the therapist owes $0 and the session is not back on
    // the owed list.
    const owedAfterDup = await storage.getTherapistOwed(therapistId);
    assertEqual(
      owedAfterDup.total,
      0,
      "getTherapistOwed total is $0 after the duplicate re-upload (no re-inflated owed)",
    );
    const dupOwedRow = owedAfterDup.items.find(
      (i) => i.sessionBillingId === billingId,
    );
    assert(
      dupOwedRow === undefined || dupOwedRow.amountRemaining === 0,
      "The already-paid session is NOT resurrected as owed by the duplicate re-upload",
    );

    // Storage proof #3: the running statement nets to $0 owed.
    const statementAfterDup = await storage.getTherapistStatement(therapistId);
    assertEqual(
      statementAfterDup.currentOwed,
      0,
      "The therapist running statement still shows $0 currentOwed after the duplicate",
    );

    // Storage proof #4: exactly ONE payout exists — the duplicate generated no
    // second over-payment.
    const allPayouts = await db
      .select()
      .from(therapistPayouts)
      .where(eq(therapistPayouts.therapistId, therapistId));
    assertEqual(
      allPayouts.length,
      1,
      "Exactly one payout exists for the therapist (the duplicate created no extra over-payment)",
    );
    assertEqual(
      Number(allPayouts[0]?.id),
      firstPayoutId,
      "The only payout is the original corrected $50 payout",
    );

    // Browser proof: reload the Owed tab AFTER the duplicate re-upload and
    // confirm the screen still reads $0.00 with the session gone.
    const owedRespAfterDup = await openOwedTab(page, baseUrl, therapistId);
    assertEqual(
      owedRespAfterDup.status(),
      200,
      "Re-opening the Owed tab after the duplicate fires GET /owed that returns 200",
    );

    // The owed table renders once the GET resolves; the previously-paid session
    // must NOT reappear.
    await page.waitForFunction(
      (sel: string) => !document.querySelector(sel),
      { timeout: 30_000 },
      owedSelector,
    );
    const owedRowStillGone = (await page.$(owedSelector)) === null;
    assert(
      owedRowStillGone,
      "After the duplicate re-upload the session is STILL off the owed list in the UI (no re-inflation)",
    );

    const totalOwedAfterDup = await page.$eval(
      '[data-testid="text-total-owed"]',
      (el: Element) => (el.textContent || "").trim(),
    );
    assertEqual(
      totalOwedAfterDup,
      "$0.00",
      "The 'Total currently owed' header STILL reads $0.00 after the duplicate re-upload",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (devServer) await devServer.stop();

    // Cleanup in FK-safe order.
    try {
      if (therapistId != null) {
        // Delete payouts first (cascades therapist_payout_items + allocations).
        await db
          .delete(therapistPayouts)
          .where(eq(therapistPayouts.therapistId, therapistId))
          .catch(() => {});
      }
      if (billingId != null) {
        await db
          .delete(paymentTransactions)
          .where(eq(paymentTransactions.sessionBillingId, billingId));
        await db
          .delete(therapistEarnings)
          .where(eq(therapistEarnings.sessionBillingId, billingId));
      }
      const statementIds = [statementId, dupStatementId].filter(
        (x): x is number => x != null,
      );
      for (const sid of statementIds) {
        await db
          .delete(auditLogs)
          .where(
            and(
              eq(auditLogs.resourceType, "insurance_statement"),
              eq(auditLogs.resourceId, String(sid)),
            ),
          )
          .catch(() => {});
      }
      if (statementIds.length > 0) {
        // Cascades insurance_statement_lines.
        await db
          .delete(insuranceStatements)
          .where(inArray(insuranceStatements.id, statementIds));
      }
      if (therapistId != null) {
        await db
          .delete(therapistPayRules)
          .where(eq(therapistPayRules.therapistId, therapistId));
        await db
          .delete(auditLogs)
          .where(eq(auditLogs.resourceType, "therapist_earning"))
          .catch(() => {});
      }
      if (billingId != null) {
        await db.delete(sessionBilling).where(eq(sessionBilling.id, billingId));
      }
      if (sessionId != null) {
        await db.delete(sessions).where(eq(sessions.id, sessionId));
      }
      if (clientId != null) {
        await db.delete(clients).where(eq(clients.id, clientId));
      }
      if (serviceId != null) {
        await db.delete(services).where(eq(services.id, serviceId));
      }
      const userIds = [therapistId, billingUserId].filter(
        (x): x is number => x != null,
      );
      if (userIds.length > 0) {
        await db.delete(users).where(inArray(users.id, userIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupErr) {
      console.error("⚠️  Cleanup error (non-fatal):", cleanupErr);
    }
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

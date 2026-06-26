/**
 * BROWSER-LEVEL test that RECORDING a therapist payout through the real
 * "Owed / Record Payout" tab actually PAYS the corrected, de-inflated amount
 * ($50) — not the inflated $100 — after a duplicate-insurance-payment cleanup.
 *
 * Sibling suites cover the lower / adjacent layers of the SAME scenario:
 *   - test/insurance-void-repost-corrects-pay.test.ts proves at the STORAGE
 *     layer that after the void → re-open → re-post cleanup of a double-counted
 *     insurance payment, the therapist earnings ledger self-corrects.
 *   - test/insurance-repost-doublecount-ui.test.ts proves at the BROWSER layer
 *     that the billing's collected insurance lands on the correct single $100.
 *   - test/therapist-statement-corrected-pay-ui.test.ts proves the THERAPIST
 *     STATEMENT tab shows the corrected $50.
 *   - test/therapist-owed-corrected-pay-ui.test.ts proves the "Owed / Record
 *     Payout" tab DISPLAYS the corrected single $50 owed amount.
 *
 * THIS suite closes the LAST remaining gap. The sibling owed-display suite
 * stops at what the screen READS — it never clicks through the actual "Record
 * payout" flow. There was no browser-level proof that when a reviewer selects
 * the session and confirms the payout, the amount WRITTEN to the therapist
 * payout (and deducted from owed) is the corrected $50, not the inflated $100.
 * A regression in the payout-write path could still overpay even though the
 * screen reads correctly.
 *
 * What it does (in order):
 *   1. Seeds a session/billing with a 50% pay rule. POSTS a $100 insurance
 *      statement (collected = $100, correct), then — simulating staff not
 *      realizing the EOB was already posted — MANUALLY keys the same $100 again
 *      so collected inflates to $200 (the classic double-count).
 *   2. Materializes the INFLATED earning by reading the therapist statement once
 *      (a single $100 earning row; pay overstated — should be $50).
 *   3. CLEANS UP operationally (no raw column edit), exactly like a real fix:
 *      void the statement → re-open it → re-post it. The guard adopts the manual
 *      $100 and posts a $0 shortfall, so collected lands back on the single $100.
 *   4. Loads /therapist-payments authenticated as a billing user, picks the
 *      therapist, opens the "Owed / Record Payout" tab, TICKS the session's
 *      checkbox (`checkbox-owed-{billingId}`), clicks "Record payout"
 *      (`button-record-payout`), confirms in the RecordPayoutDialog
 *      (`button-confirm-payout`), and:
 *        - asserts the created payout returned by POST /payouts has
 *          totalAmount === "50.00" (the corrected single $50, NOT $100),
 *        - asserts the DB therapist_payouts / therapist_payout_items rows store
 *          the corrected $50 — the money actually WRITTEN,
 *        - asserts the session drops off the owed list and "Total currently
 *          owed" falls to $0.00, confirming no double-pay / no residual owed.
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/therapist-owed-record-payout-amount-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named rows and removes them (and
 *   anything derived — including the created payout) in a finally block.
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

const SUFFIX = `thr-owed-record-payout-ui-${Date.now()}`;

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
    // Post a $100 statement (collected = $100, correct).
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
      "duplicate EOB cleanup — record-payout amount check",
    );
    await storage.reopenInsuranceStatement(statementId, billingUserId);
    await storage.postInsuranceStatement(statementId, billingUserId);

    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "After void → re-open → re-post, collected is back on the correct single $100",
    );

    // --- 4. Browser flow: open the Owed tab and RECORD the payout ----------
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

    await page.goto(`${baseUrl}/therapist-payments`, {
      waitUntil: "domcontentloaded",
    });

    // Open the therapist picker (a Radix Popover — needs a TRUSTED click; a
    // synthetic DOM .click() does not open it). Then type our therapist's unique
    // name into the cmdk search so the option renders even with a long list, and
    // pick it.
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

    // Tabs appear once a therapist is chosen. The "Owed / Record Payout" tab is
    // the default, but click it explicitly to be deterministic. Opening it fires
    // GET /owed server-side, which recomputes the owed amount LIVE from the
    // (now-corrected) collected basis.
    const [owedResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes(`/api/therapist-pay/owed/${therapistId}`) &&
          res.request().method() === "GET",
        { timeout: 45_000 },
      ),
      clickTabById(page, "tab-owed"),
    ]);
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
    const preOwedText = await page.$eval(owedSelector, (el: Element) =>
      (el.textContent || "").trim(),
    );
    assertEqual(
      preOwedText,
      "$50.00",
      "Before payout the session's owed amount is the corrected single $50 (not the inflated $100)",
    );

    // Tick the session's checkbox. Radix Checkbox needs a TRUSTED click.
    await clickById(page, `checkbox-owed-${billingId}`);

    // The "Record payout" button reflects the selection (count + total) and
    // becomes enabled. Assert it now reads the corrected $50, then open it.
    await page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-testid="button-record-payout"]',
        ) as HTMLButtonElement | null;
        return !!btn && !btn.disabled && (btn.textContent || "").includes("$50.00");
      },
      { timeout: 30_000 },
    );
    const recordBtnText = await page.$eval(
      '[data-testid="button-record-payout"]',
      (el: Element) => (el.textContent || "").trim(),
    );
    assert(
      recordBtnText.includes("$50.00") && !recordBtnText.includes("$100.00"),
      "The 'Record payout' button totals the corrected $50 for the selected session (not $100)",
    );
    await clickById(page, "button-record-payout");

    // The RecordPayoutDialog confirms the same corrected total in its body.
    await page.waitForSelector('[data-testid="button-confirm-payout"]', {
      timeout: 30_000,
    });

    // Confirm the payout and capture the POST /payouts response so we can assert
    // the amount the server actually WROTE.
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
      "The created payout's totalAmount is the corrected single $50 — NOT the inflated $100",
    );
    assert(
      String(payoutBody.totalAmount) !== "100.00",
      "The created payout's totalAmount is NOT the inflated $100",
    );
    const createdPayoutId = Number(payoutBody.id);
    assertEqual(
      Array.isArray(payoutBody.allocations) && payoutBody.allocations.length,
      1,
      "The payout covers exactly the one selected session",
    );
    assertEqual(
      Number(payoutBody.allocations?.[0]?.amountAllocated),
      50,
      "The payout allocation applies the corrected $50 to the session (not $100)",
    );

    // --- DB proof: the money actually WRITTEN is the corrected $50 ---------
    const [dbPayout] = await db
      .select()
      .from(therapistPayouts)
      .where(eq(therapistPayouts.id, createdPayoutId))
      .limit(1);
    assert(!!dbPayout, "The payout row was persisted to therapist_payouts");
    assertEqual(
      Number(dbPayout.totalAmount),
      50,
      "Persisted therapist_payouts.total_amount is the corrected $50 (the real money paid)",
    );

    const payoutItems = await db
      .select()
      .from(therapistPayoutItems)
      .where(eq(therapistPayoutItems.payoutId, createdPayoutId));
    assertEqual(
      payoutItems.length,
      1,
      "Exactly one therapist_payout_items row was written for the session",
    );
    assertEqual(
      Number(payoutItems[0]?.sessionBillingId),
      billingId,
      "The payout item is for the seeded session billing",
    );
    assertEqual(
      Number(payoutItems[0]?.amountEarned),
      50,
      "The payout item's amount_earned (paid) is the corrected $50 — not the inflated $100",
    );

    // --- After payout the session drops off owed; total falls to $0 -------
    // The dialog success path invalidates the owed query, so the list refetches
    // and the now-fully-paid session disappears (amountRemaining === 0).
    await page.waitForFunction(
      (sel: string) => !document.querySelector(sel),
      { timeout: 30_000 },
      owedSelector,
    );
    const owedRowGone = (await page.$(owedSelector)) === null;
    assert(
      owedRowGone,
      "After recording the payout the session drops off the owed list (no residual owed, no double-pay)",
    );

    const totalOwedAfter = await page.$eval(
      '[data-testid="text-total-owed"]',
      (el: Element) => (el.textContent || "").trim(),
    );
    assertEqual(
      totalOwedAfter,
      "$0.00",
      "The 'Total currently owed' header card falls to $0.00 after the corrected payout",
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
      if (statementId != null) {
        await db
          .delete(auditLogs)
          .where(
            and(
              eq(auditLogs.resourceType, "insurance_statement"),
              eq(auditLogs.resourceId, String(statementId)),
            ),
          )
          .catch(() => {});
        // Cascades insurance_statement_lines.
        await db
          .delete(insuranceStatements)
          .where(eq(insuranceStatements.id, statementId));
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

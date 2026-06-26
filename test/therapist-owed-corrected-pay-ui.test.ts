/**
 * BROWSER-LEVEL test that the "Owed / Record Payout" screen a reviewer uses to
 * RECORD a therapist payout shows the CORRECTED, de-inflated owed amount after a
 * duplicate-insurance-payment cleanup — driven through the real
 * /therapist-payments page in a real Chromium.
 *
 * Sibling suites cover the lower / adjacent layers of the SAME scenario:
 *   - test/insurance-void-repost-corrects-pay.test.ts proves at the STORAGE
 *     layer that after the void → re-open → re-post cleanup of a double-counted
 *     insurance payment, the therapist earnings ledger self-corrects (net pay
 *     falls from the inflated $100 back to the correct $50).
 *   - test/insurance-repost-doublecount-ui.test.ts proves at the BROWSER layer
 *     that the billing's collected insurance and the reconciliation "Posted
 *     total" card land on the correct single $100 after the UI re-post.
 *   - test/therapist-statement-corrected-pay-ui.test.ts proves at the BROWSER
 *     layer that the THERAPIST STATEMENT tab shows the corrected $50.
 *
 * THIS suite closes the remaining gap: the screen a reviewer actually clicks to
 * RECORD a payout is the "Owed / Record Payout" tab, and there was no
 * browser-level proof that the per-session owed amount it shows is the corrected
 * single value. If that tab still showed the inflated amount, a reviewer could
 * overpay the therapist even though the statement is correct.
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
 *      therapist, opens the "Owed / Record Payout" tab, and asserts the
 *      session's owed amount (data-testid `text-owed-amount-{billingId}`) reads
 *      the corrected single $50.00 (NOT the inflated $100.00), and the
 *      "Total currently owed" header card agrees.
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/therapist-owed-corrected-pay-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named rows and removes them (and
 *   anything derived) in a finally block.
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

const SUFFIX = `thr-owed-corrected-ui-${Date.now()}`;

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
      "duplicate EOB cleanup — owed/payout UI check",
    );
    await storage.reopenInsuranceStatement(statementId, billingUserId);
    await storage.postInsuranceStatement(statementId, billingUserId);

    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "After void → re-open → re-post, collected is back on the correct single $100",
    );

    // --- 4. Browser flow: load the Owed / Record Payout screen -------------
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

    // CRITICAL UI money check: the per-session owed amount the reviewer would
    // pay out shows the CORRECTED single $50 — NOT the inflated $100, and NOT $0.
    const owedSelector = `[data-testid="text-owed-amount-${billingId}"]`;
    await page.waitForFunction(
      (sel: string) => {
        const el = document.querySelector(sel);
        return !!el && (el.textContent || "").trim() === "$50.00";
      },
      { timeout: 30_000 },
      owedSelector,
    );

    const owedText = await page.$eval(owedSelector, (el: Element) =>
      (el.textContent || "").trim(),
    );
    assertEqual(
      owedText,
      "$50.00",
      "The session's owed amount on the Record Payout tab is the corrected single $50 after cleanup (not the inflated $100)",
    );
    assert(
      owedText !== "$100.00",
      "The session's owed amount is NOT the inflated $100.00",
    );

    // The "Total currently owed" header card agrees — this is the single seeded
    // payable session, so the total equals the corrected $50.
    const totalOwedText = await page.$eval(
      '[data-testid="text-total-owed"]',
      (el: Element) => (el.textContent || "").trim(),
    );
    assertEqual(
      totalOwedText,
      "$50.00",
      "The 'Total currently owed' header card shows the corrected single $50 after cleanup",
    );
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (devServer) await devServer.stop();

    // Cleanup in FK-safe order.
    try {
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

/**
 * BROWSER-LEVEL test for the duplicate-payment double-count guard, driven
 * through the REAL /insurance-reconciliation screen a billing staffer clicks,
 * in a real Chromium.
 *
 * Sibling suites cover the lower / adjacent layers:
 *   - test/insurance-void-repost-corrects-pay.test.ts proves the SAME
 *     double-count scenario at the STORAGE layer: when staff also keyed the EOB
 *     manually (stacking collected to $200), the void → re-open → re-post flow
 *     adopts the manual payment and lands collected on the correct single $100,
 *     and therapist pay self-corrects.
 *   - test/insurance-reopen-repost-ui.test.ts proves the UI re-open → re-post
 *     button wiring when the statement is the ONLY source of payment (collected
 *     never inflates past $100).
 *
 * THIS suite closes the remaining gap: the HARD double-count case, end-to-end,
 * through the actual UI. A billing staffer who posted an EOB, then accidentally
 * keyed the same EOB manually (collected balloons to $200), would clean it up
 * through the reconciliation screen: Void → Re-open → Post again. There was no
 * browser-level proof that doing this cleanup through the real buttons lands the
 * money back on the correct single $100 instead of leaving (or re-doubling) it
 * at $200. Only a browser test that loads the page, opens the over-collected
 * posted statement, and clicks Void → Re-open → Post can prove the real wiring
 * keeps the double-count from surviving a UI re-post.
 *
 * What it does (in order, mirroring real usage):
 *   1. Seeds a billing and POSTS a $100 insurance statement against it
 *      (collected = $100, correct). Then — simulating staff not realizing the
 *      EOB was already posted — MANUALLY keys the same $100 again so collected
 *      inflates to $200 (the classic double-count). The statement starts in the
 *      'posted' state, with the billing over-collected to $200.
 *   2. Loads /insurance-reconciliation authenticated as a billing user, opens
 *      the statement detail, and through the REAL buttons:
 *        a. Void: clicks Void, types a reason, confirms — POST /void → 200.
 *           Collected drops back to the lone manual $100.
 *        b. Re-open: clicks Re-open, confirms — POST /reopen → 200. Statement
 *           returns to a re-postable 'draft'.
 *        c. Post: clicks Post — POST /post → 200. The guard ADOPTS the manual
 *           $100 and posts a $0 shortfall, so collected STAYS on the single
 *           $100 (never re-stacks to $200).
 *   3. Asserts the "Posted total" card shows the correct single $100 (not $200,
 *      and not $0) AND the billing's collected insurance is the single $100.
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/insurance-repost-doublecount-ui.test.ts
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

const SUFFIX = `ins-repost-dc-ui-${Date.now()}`;

// A plain <button> with an onClick fires its React handler from a DOM .click(),
// so for these (the Void/Re-open triggers and their dialog confirms) we wait for
// the element then DOM-click it in-page. This sidesteps puppeteer's
// clickablePoint check, which throws "Node is either not clickable or not an
// Element" while a Radix Dialog is mid slide/fade-in. See
// .agents/memory/browser-tests-puppeteer.md.
async function clickTestId(page: Page, testId: string) {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    el?.click();
  }, selector);
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
    // --- Seed an over-collected ($200) posted insurance statement ----------
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    // A billing-role user can reach /insurance-reconciliation and the routes.
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

    await db.insert(therapistPayRules).values({
      therapistId,
      serviceId: null,
      payType: "percentage",
      payValue: "50.00",
    });

    // Create + confirm + post a $100 statement. This records the REAL insurer
    // $100 — collected becomes $100 (correct).
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
    // so 200 means "add another $100 manual row on top". This stacks a second,
    // unadopted manual insurance row → collected inflates to $200 (double count).
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

    // Precondition: the statement is posted before the UI cleanup begins.
    const [stmtBefore] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, statementId))
      .limit(1);
    assertEqual(
      stmtBefore.status,
      "posted",
      "Precondition — seeded statement is in the 'posted' state",
    );

    // --- Browser flow ------------------------------------------------------
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

    // Open the reconciliation page and the seeded statement's detail.
    await page.goto(`${baseUrl}/insurance-reconciliation`, {
      waitUntil: "domcontentloaded",
    });
    await clickTestId(page, `button-open-statement-${statementId}`);
    await page.waitForSelector('[data-testid="view-statement-detail"]', {
      timeout: 30_000,
    });

    // The posted statement shows the Void button (posted-only).
    await page.waitForSelector('[data-testid="button-void-statement"]', {
      timeout: 30_000,
    });

    // --- 1. Void through the UI -------------------------------------------
    // Click Void, type a reason (the confirm button is disabled until a reason
    // is present), confirm, and wait for POST /void → 200.
    await clickTestId(page, "button-void-statement");
    await page.waitForSelector('[data-testid="input-void-reason"]', {
      timeout: 30_000,
    });
    await page.type(
      '[data-testid="input-void-reason"]',
      "duplicate EOB cleanup — UI double-count check",
    );
    const [voidResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes(`/api/insurance/statements/${statementId}/void`) &&
          res.request().method() === "POST",
        { timeout: 30_000 },
      ),
      clickTestId(page, "button-confirm-void"),
    ]);
    assertEqual(
      voidResp.status(),
      200,
      "Confirming the dialog fires POST /void that returns 200",
    );

    // After voiding, the Re-open button (voided-only) appears.
    await page.waitForSelector('[data-testid="button-reopen-statement"]', {
      timeout: 30_000,
    });

    // Voiding drops collected back to the lone manual $100.
    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "Voiding through the UI drops collected back to the lone manual $100",
    );

    // --- 2. Re-open through the UI ----------------------------------------
    await clickTestId(page, "button-reopen-statement");
    await page.waitForSelector('[data-testid="button-confirm-reopen"]', {
      timeout: 30_000,
    });
    const [reopenResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res
            .url()
            .includes(`/api/insurance/statements/${statementId}/reopen`) &&
          res.request().method() === "POST",
        { timeout: 30_000 },
      ),
      clickTestId(page, "button-confirm-reopen"),
    ]);
    assertEqual(
      reopenResp.status(),
      200,
      "Confirming the dialog fires POST /reopen that returns 200",
    );

    // The page returns to a re-postable state: the Post button reappears.
    await page.waitForSelector('[data-testid="button-post-statement"]', {
      timeout: 30_000,
    });

    // --- 3. Re-post through the UI ----------------------------------------
    // The Post button has no confirm dialog — clicking it fires POST /post
    // directly. The guard ADOPTS the still-unadopted manual $100 and posts a $0
    // shortfall, so collected STAYS on the correct single $100.
    const [postResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes(`/api/insurance/statements/${statementId}/post`) &&
          res.request().method() === "POST",
        { timeout: 30_000 },
      ),
      clickTestId(page, "button-post-statement"),
    ]);
    assertEqual(
      postResp.status(),
      200,
      "Clicking Post after re-open fires POST /post that returns 200",
    );

    // After re-posting, the statement flips to 'posted': the Void button
    // (posted-only) reappears.
    await page.waitForSelector('[data-testid="button-void-statement"]', {
      timeout: 30_000,
    });

    // CRITICAL UI money check: the "Posted total" card shows the correct SINGLE
    // $100 — NOT the doubled $200, and NOT $0.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="text-posted-total"]');
        return !!el && (el.textContent || "").trim() === "$100.00";
      },
      { timeout: 30_000 },
    );
    const postedTotalText = await page.$eval(
      '[data-testid="text-posted-total"]',
      (el: Element) => (el.textContent || "").trim(),
    );
    assertEqual(
      postedTotalText,
      "$100.00",
      "The 'Posted total' card shows the correct single $100 after the UI re-post (not the doubled $200)",
    );

    // The status badge now reads "Posted".
    const headerStatus = await page.$eval(
      '[data-testid="view-statement-detail"] h1',
      (el: Element) => el.textContent || "",
    );
    assert(
      /Posted/.test(headerStatus),
      "The statement detail header now shows the 'Posted' status badge",
    );

    // Persisted statement row is 'posted' again.
    const [stmtReposted] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, statementId))
      .limit(1);
    assertEqual(
      stmtReposted.status,
      "posted",
      "Persisted statement row is back to 'posted' after the UI re-post",
    );

    // The matched line is 'posted' again.
    const [lineReposted] = await db
      .select()
      .from(insuranceStatementLines)
      .where(eq(insuranceStatementLines.id, lineId!))
      .limit(1);
    assertEqual(
      lineReposted.matchStatus,
      "posted",
      "The matched claim line is 'posted' again after the UI re-post",
    );

    // CRITICAL money check: the billing's collected insurance is the correct
    // single $100, NOT doubled to $200. This is the end-to-end UI proof that the
    // double-count can't survive a re-post done through the reconciliation
    // screen.
    const [billingAfter] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId!))
      .limit(1);
    assertEqual(
      Number(billingAfter.insurancePaidAmount),
      100,
      "Billing's collected insurance is the correct single $100 after the UI re-post (not doubled to $200)",
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

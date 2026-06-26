/**
 * BROWSER-LEVEL test for the "Re-open to fix & re-post" control on a VOIDED
 * insurance statement — driven through the REAL reconciliation screen a billing
 * staffer clicks, in a real Chromium.
 *
 * Sibling suites cover the lower layers:
 *   - test/insurance-void-repost-corrects-pay.test.ts proves the end-to-end
 *     money correctness of void → re-open → re-post at the STORAGE layer.
 *   - test/insurance-voided-statement-locked.test.ts proves a voided statement's
 *     lines can't be edited via the HTTP API / storage layer.
 *
 * THIS suite closes the topmost gap: the actual button flow in the UI. A bug in
 * the detail page (the Re-open button rendering on a non-voided statement, the
 * confirm dialog never firing the POST, or the page not refreshing back to a
 * re-postable state) would let staff believe they can re-post when they can't,
 * or vice-versa. Only a browser test that loads the page, opens the voided
 * statement, clicks Re-open, confirms the dialog, and watches the page return to
 * a draft/re-postable state can prove the real wiring works.
 *
 * What it does (in order, mirroring real usage):
 *   1. Seeds a billing, posts a $100 insurance statement against it, then VOIDS
 *      it — so the statement starts in the terminal 'voided' state.
 *   2. Loads /insurance-reconciliation authenticated as a billing user, opens
 *      the statement detail, and asserts the "Re-open to fix & re-post" button
 *      IS shown while the "Post" button is NOT (Re-open is voided-only).
 *   3. Clicks Re-open, confirms the dialog, waits for the POST /reopen to return
 *      200, and asserts the page returns to a re-postable state: the Post button
 *      reappears, the Re-open button is gone, and the status badge reads "Draft".
 *      Confirms the persisted statement row flipped to 'draft' too.
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/insurance-reopen-repost-ui.test.ts
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

const SUFFIX = `ins-reopen-ui-${Date.now()}`;

// A plain <button> with an onClick fires its React handler from a DOM .click(),
// so for these (the Re-open trigger and its dialog confirm) we wait for the
// element then DOM-click it in-page. This sidesteps puppeteer's clickablePoint
// check, which throws "Node is either not clickable or not an Element" while a
// Radix Dialog is mid slide/fade-in. See .agents/memory/browser-tests-puppeteer.md.
async function clickTestId(page: Page, testId: string) {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    el?.click();
  }, selector);
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
    // --- Seed a posted-then-voided insurance statement --------------------
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

    // Create + confirm + post a $100 statement, then void it.
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
    await storage.voidInsuranceStatement(
      statementId,
      billingUserId,
      "test void — UI re-open check",
    );

    // Precondition: the statement is voided before the UI test begins.
    const [stmtBefore] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, statementId))
      .limit(1);
    assertEqual(
      stmtBefore.status,
      "voided",
      "Precondition — seeded statement is in the terminal 'voided' state",
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

    // Re-open is voided-only: the Re-open button shows, the Post button doesn't.
    await page.waitForSelector('[data-testid="button-reopen-statement"]', {
      timeout: 30_000,
    });
    const reopenBtn = await page.$('[data-testid="button-reopen-statement"]');
    assert(
      reopenBtn !== null,
      "The 'Re-open to fix & re-post' button is shown on the voided statement",
    );
    const postBtnWhileVoided = await page.$(
      '[data-testid="button-post-statement"]',
    );
    assert(
      postBtnWhileVoided === null,
      "The Post button is NOT shown while the statement is voided",
    );

    // Click Re-open, confirm the dialog, and wait for the POST /reopen to 200.
    await clickTestId(page, "button-reopen-statement");
    await page.waitForSelector('[data-testid="button-confirm-reopen"]', {
      timeout: 30_000,
    });
    const [reopenResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes(`/api/insurance/statements/${statementId}/reopen`) &&
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

    // The page returns to a re-postable state: Post reappears, Re-open is gone.
    await page.waitForSelector('[data-testid="button-post-statement"]', {
      timeout: 30_000,
    });
    const postBtnAfter = await page.$('[data-testid="button-post-statement"]');
    assert(
      postBtnAfter !== null,
      "After re-opening, the Post button reappears (statement is re-postable)",
    );
    const reopenBtnAfter = await page.$(
      '[data-testid="button-reopen-statement"]',
    );
    assert(
      reopenBtnAfter === null,
      "After re-opening, the Re-open button is gone (no longer voided)",
    );

    // The status badge now reads "Draft".
    const detailText = await page.$eval(
      '[data-testid="view-statement-detail"]',
      (el: Element) => el.textContent || "",
    );
    assert(
      /Draft/.test(detailText),
      "The statement detail now shows the 'Draft' status badge",
    );

    // Persisted row flipped back to a re-postable 'draft'.
    const [stmtAfter] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, statementId))
      .limit(1);
    assertEqual(
      stmtAfter.status,
      "draft",
      "Persisted statement row is back to 'draft' after the UI re-open",
    );

    // --- Re-post through the UI and verify the money lands correctly --------
    // The whole point of re-open is to fix-and-re-post. The Post button has no
    // confirm dialog — clicking it fires POST /post directly. We click it, wait
    // for the POST to 200, and then prove the statement re-posts the correct
    // SINGLE $100 (never the doubled $200) both in the UI and in the billing row.
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

    // After re-posting, the statement flips to 'posted': the Void button (posted-
    // only) reappears and the status badge reads "Posted".
    await page.waitForSelector('[data-testid="button-void-statement"]', {
      timeout: 30_000,
    });
    const voidBtnAfterRepost = await page.$(
      '[data-testid="button-void-statement"]',
    );
    assert(
      voidBtnAfterRepost !== null,
      "After re-posting, the Void button reappears (statement is posted again)",
    );

    // The "Posted total" card shows the correct SINGLE $100 — not $0 (which the
    // old postedAmount-based tile showed once a payment was adopted) and not a
    // doubled $200.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="text-posted-total"]',
        );
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
      "The 'Posted total' card shows the correct single $100 after re-posting",
    );

    // The status badge now reads "Posted" (in the detail header, not the card).
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
    // re-post records the right money without double-counting.
    const [billingAfter] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId!))
      .limit(1);
    assertEqual(
      Number(billingAfter.insurancePaidAmount),
      100,
      "Billing's collected insurance is the correct single $100 after re-post (not doubled)",
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

/**
 * BROWSER-LEVEL test for the FAILURE feedback of the "Re-open to fix & re-post"
 * control on a VOIDED insurance statement — driven through the REAL
 * reconciliation screen in a real Chromium.
 *
 * Sibling suite test/insurance-reopen-repost-ui.test.ts covers the HAPPY path
 * (a voided statement re-opens and becomes re-postable). THIS suite closes the
 * complementary gap: when the re-open POST is REJECTED by the server, does the
 * billing staffer actually SEE a clear error — and does the statement stay
 * voided in the UI rather than silently appearing to succeed?
 *
 * The realistic way a re-open gets rejected is a race: the page still shows the
 * statement as voided (so the "Re-open" button renders), but server-side the
 * statement is no longer voided because someone else already re-opened (or
 * otherwise advanced) it. The re-open route then returns
 * 400 "Only a voided statement can be re-opened". A regression that swallowed
 * that error would leave staff believing nothing went wrong.
 *
 * What it does (in order, mirroring that race):
 *   1. Seeds a billing, posts a $100 insurance statement against it, then VOIDS
 *      it — so the statement starts in the terminal 'voided' state.
 *   2. Loads /insurance-reconciliation authenticated as a billing user, opens
 *      the statement detail, and asserts the "Re-open to fix & re-post" button
 *      IS shown (the page's view of the statement is voided).
 *   3. Behind the page's back, re-opens the statement at the STORAGE layer so
 *      it is no longer voided server-side (simulating another staffer). The UI
 *      is NOT refreshed, so it still shows the stale voided view + Re-open btn.
 *   4. Clicks Re-open, confirms the dialog, waits for POST /reopen to return
 *      400, and asserts:
 *        - a destructive "Already re-opened" toast appears explaining the
 *          statement is no longer voided and to refresh,
 *        - the statement detail in the UI STILL shows the "Voided" badge and
 *          the Re-open button (the failed attempt didn't fake a success).
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/insurance-reopen-reject-ui.test.ts
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

const SUFFIX = `ins-reopen-reject-ui-${Date.now()}`;

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
      "test void — UI re-open reject check",
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

    // The page's view is voided, so the Re-open button is shown.
    await page.waitForSelector('[data-testid="button-reopen-statement"]', {
      timeout: 30_000,
    });
    const reopenBtn = await page.$('[data-testid="button-reopen-statement"]');
    assert(
      reopenBtn !== null,
      "The 'Re-open to fix & re-post' button is shown on the voided statement",
    );

    // --- Simulate a concurrent re-open by someone else --------------------
    // Flip the statement out of 'voided' at the storage layer WITHOUT touching
    // the browser. The page keeps its stale voided view (and Re-open button),
    // so the next click will hit the server's "Only a voided ..." guard.
    await storage.reopenInsuranceStatement(statementId, billingUserId);
    const [stmtRaced] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, statementId))
      .limit(1);
    assertEqual(
      stmtRaced.status,
      "draft",
      "Precondition — a concurrent re-open moved the statement out of 'voided' server-side",
    );

    // --- Click Re-open and expect the server to REJECT it -----------------
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
      400,
      "Confirming the dialog fires POST /reopen that the server rejects with 400",
    );

    // The user SEES a clear destructive error toast (not a silent failure).
    await page.waitForFunction(
      () => document.body.innerText.includes("Already re-opened"),
      { timeout: 10_000 },
    );
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(
      bodyText.includes("Already re-opened"),
      'An "Already re-opened" error toast appears when the re-open is rejected',
    );
    assert(
      /no longer voided/i.test(bodyText),
      "The toast explains the statement is no longer voided (clear, actionable cause)",
    );

    // The UI must NOT pretend the re-open succeeded: the statement still reads
    // voided in the page and the Re-open button is still there.
    const detailText = await page.$eval(
      '[data-testid="view-statement-detail"]',
      (el: Element) => el.textContent || "",
    );
    assert(
      /Voided/.test(detailText),
      "The statement detail still shows the 'Voided' badge after the rejected re-open",
    );
    const reopenBtnAfter = await page.$(
      '[data-testid="button-reopen-statement"]',
    );
    assert(
      reopenBtnAfter !== null,
      "The Re-open button is still shown (the failed attempt didn't fake a success)",
    );
    const postBtnAfter = await page.$('[data-testid="button-post-statement"]');
    assert(
      postBtnAfter === null,
      "The Post button is still NOT shown (UI did not flip to a re-postable state)",
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

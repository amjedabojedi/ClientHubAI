/**
 * BROWSER-LEVEL test for the FAILURE feedback of the "Post payment(s)" control on
 * a postable insurance statement — driven through the REAL reconciliation screen
 * in a real Chromium.
 *
 * Sibling suites test/insurance-void-reject-ui.test.ts and
 * test/insurance-reopen-reject-ui.test.ts cover the same gap for the neighbouring
 * "Void" and "Re-open" actions. THIS suite closes it for POST: when the post
 * POST is REJECTED by the server, does the billing staffer actually SEE a clear,
 * actionable error — and does the statement stay un-posted in the UI rather than
 * silently appearing to succeed?
 *
 * The realistic way a post gets rejected is a race: the page still shows the
 * statement as a postable draft (so the enabled "Post" button renders), but
 * server-side the statement is no longer postable because someone else already
 * voided it. The post route then returns 400 "Cannot post a voided statement.".
 * A regression that swallowed that error (or faked success) would leave staff
 * believing the payments posted when nothing happened.
 *
 * What it does (in order, mirroring that race):
 *   1. Seeds a billing and a $100 insurance statement with one CONFIRMED line —
 *      so the statement starts in the 'draft' (postable) state with an enabled
 *      Post button.
 *   2. Loads /insurance-reconciliation authenticated as a billing user, opens
 *      the statement detail, and asserts the "Post" button IS shown (and the
 *      statement reads Draft).
 *   3. Behind the page's back, voids the statement at the STORAGE layer so it is
 *      no longer postable server-side (simulating another staffer). The UI is
 *      NOT refreshed, so it still shows the stale draft view + Post button.
 *   4. Clicks Post, waits for POST /post to return 400, and asserts:
 *        - a destructive "Can't post — statement changed" toast appears
 *          explaining the statement is no longer postable and to refresh,
 *        - the statement detail in the UI STILL shows the "Draft" badge and the
 *          Post button, and does NOT show the Void button (the failed attempt
 *          didn't fake a successful post).
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/insurance-post-reject-ui.test.ts
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

const SUFFIX = `ins-post-reject-ui-${Date.now()}`;

// A plain <button> with an onClick fires its React handler from a DOM .click(),
// so for the Post trigger we wait for the element then DOM-click it in-page.
// This sidesteps puppeteer's clickablePoint check, which can throw
// "Node is either not clickable or not an Element" during a re-render.
// See .agents/memory/browser-tests-puppeteer.md.
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
    // --- Seed a postable (draft, one confirmed line) insurance statement ---
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

    // Create a $100 statement and CONFIRM its line, but leave it as a DRAFT
    // (do NOT post it) — so the page shows an enabled Post button.
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

    // Precondition: the statement is a postable draft before the UI test begins.
    const [stmtBefore] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, statementId))
      .limit(1);
    assertEqual(
      stmtBefore.status,
      "draft",
      "Precondition — seeded statement is in the postable 'draft' state",
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

    // The page's view is a postable draft, so the Post button is shown enabled.
    await page.waitForSelector(
      '[data-testid="button-post-statement"]:not([disabled])',
      { timeout: 30_000 },
    );
    const postBtn = await page.$('[data-testid="button-post-statement"]');
    assert(
      postBtn !== null,
      "The 'Post' button is shown enabled on the postable draft statement",
    );

    // --- Simulate a concurrent void by someone else -----------------------
    // Flip the statement to 'voided' at the storage layer WITHOUT touching the
    // browser. The page keeps its stale draft view (and Post button), so the
    // next click will hit the server's "Cannot post a voided statement." guard.
    await storage.voidInsuranceStatement(
      statementId,
      billingUserId,
      "concurrent void by another staffer",
    );
    const [stmtRaced] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, statementId))
      .limit(1);
    assertEqual(
      stmtRaced.status,
      "voided",
      "Precondition — a concurrent void moved the statement out of a postable state server-side",
    );

    // --- Click Post and expect the server to REJECT it --------------------
    const [postResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res
            .url()
            .includes(`/api/insurance/statements/${statementId}/post`) &&
          res.request().method() === "POST",
        { timeout: 30_000 },
      ),
      clickTestId(page, "button-post-statement"),
    ]);
    assertEqual(
      postResp.status(),
      400,
      "Clicking Post fires POST /post that the server rejects with 400",
    );

    // The user SEES a clear destructive error toast (not a silent failure).
    await page.waitForFunction(
      () => document.body.innerText.includes("Can't post — statement changed"),
      { timeout: 10_000 },
    );
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(
      bodyText.includes("Can't post — statement changed"),
      'A "Can\'t post — statement changed" error toast appears when the post is rejected',
    );
    assert(
      /no longer in a postable state/i.test(bodyText),
      "The toast explains the statement is no longer postable (clear, actionable cause)",
    );
    assert(
      /someone else may have voided or changed it/i.test(bodyText),
      "The toast tells the user another staffer changed it and to refresh",
    );

    // The UI must NOT pretend the post succeeded: the statement still reads as a
    // draft in the page, the Post button is still there, and the Void button
    // (which would only appear once posted) is absent.
    const detailText = await page.$eval(
      '[data-testid="view-statement-detail"]',
      (el: Element) => el.textContent || "",
    );
    assert(
      /Draft/.test(detailText),
      "The statement detail still shows the 'Draft' badge after the rejected post",
    );
    const postBtnAfter = await page.$(
      '[data-testid="button-post-statement"]',
    );
    assert(
      postBtnAfter !== null,
      "The Post button is still shown (the failed attempt didn't fake a success)",
    );
    const voidBtnAfter = await page.$(
      '[data-testid="button-void-statement"]',
    );
    assert(
      voidBtnAfter === null,
      "The Void button is still NOT shown (UI did not flip to a posted state)",
    );

    // And the billing must NOT have received the insurance payment: a faked or
    // real post would have moved insurancePaidAmount to $100.
    const [billingAfter] = await db
      .select({ insurancePaid: sessionBilling.insurancePaidAmount })
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId))
      .limit(1);
    assertEqual(
      Number(billingAfter.insurancePaid),
      0,
      "The session billing's insurance amount is unchanged (no payment was posted)",
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

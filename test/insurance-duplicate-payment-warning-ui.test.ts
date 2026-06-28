/**
 * BROWSER-LEVEL test for the duplicate-insurance-payment ADVISORY WARNING in
 * the Record Payment dialog (PaymentDialog in client/src/pages/billing-dashboard.tsx),
 * driven through the REAL /billing screen a billing staffer clicks, in a real
 * Chromium.
 *
 * Background:
 *   Task #192 added an entry-time guard to the Record Payment dialog. When a
 *   staffer keys a MANUAL insurance amount that closely matches an insurance
 *   payment ALREADY posted from an uploaded statement (an EOB) for the same
 *   billing, it is almost always the same EOB being re-keyed by hand — which
 *   would double-count collected insurance. The dialog surfaces an advisory
 *   warning (data-testid="duplicate-statement-warning"), DISABLES the submit
 *   button (data-testid="record-payment-submit"), and only re-enables it once
 *   the staffer ticks an override checkbox
 *   (data-testid="confirm-duplicate-insurance-checkbox") to confirm it really is
 *   a separate, additional payment.
 *
 * Sibling suite:
 *   - test/insurance-repost-doublecount-ui.test.ts proves the OTHER half of the
 *     double-count defense end-to-end: that voiding → re-opening → re-posting a
 *     statement through the reconciliation screen cannot re-stack collected. THIS
 *     suite closes the remaining gap: the ENTRY-TIME guard that stops the manual
 *     double-key from ever happening in the first place.
 *
 * What it does (in order, mirroring real usage):
 *   1. Seeds a $200 billing in the CURRENT month and POSTS a $100 insurance
 *      statement against it. Posting records a real insurance payment carrying
 *      sourceStatementId, so the billing shows collected insurance $100 and is
 *      'billed' (still partially owed → the table renders the "Pay" button).
 *   2. Loads /billing authenticated as a billing user, clicks the seeded
 *      record's Pay button, and opens the Record Payment dialog.
 *   3. Types $100 (matching the posted EOB) into the manual Insurance amount and
 *      asserts:
 *        a. the duplicate-statement-warning appears, AND
 *        b. the record-payment-submit button is DISABLED.
 *   4. Ticks confirm-duplicate-insurance-checkbox and asserts the submit button
 *      becomes ENABLED (staff can deliberately override).
 *   5. Clears the override + amount and types a DIFFERENT top-up amount ($50)
 *      and asserts the warning does NOT appear (genuine, different payments are
 *      not flagged) and submit is enabled.
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/insurance-duplicate-payment-warning-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named rows and removes them (and
 *   anything derived) in a finally block. The billing is seeded in the CURRENT
 *   month because the dashboard defaults its date filter to the current month.
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

const SUFFIX = `ins-dup-warn-ui-${Date.now()}`;

// A plain <button>/<input> with an onClick/onChange fires its React handler from
// a DOM .click(), so we wait for the element then DOM-click it in-page. This
// sidesteps puppeteer's clickablePoint check, which throws while a Radix slide-
// over is mid animation. See .agents/memory/browser-tests-puppeteer.md.
async function clickTestId(page: Page, testId: string) {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    el?.click();
  }, selector);
}

// Set a controlled React <input>'s value the way a real keystroke would, so
// React's onChange fires. Using the native value setter + dispatching an
// 'input' event is the reliable cross-version way to drive a controlled input.
async function setInputValue(page: Page, testId: string, value: string) {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.evaluate(
    (sel: string, val: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) return;
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value,
  );
}

async function isSubmitDisabled(page: Page): Promise<boolean> {
  return page.$eval(
    '[data-testid="record-payment-submit"]',
    (el: Element) => (el as HTMLButtonElement).disabled,
  );
}

async function warningVisible(page: Page): Promise<boolean> {
  return page.evaluate(
    () => !!document.querySelector('[data-testid="duplicate-statement-warning"]'),
  );
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
    // --- Seed a $200 billing with a posted $100 insurance statement ---------
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

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
        baseRate: "200.00",
      })
      .returning();
    serviceId = service.id;

    // The billing dashboard defaults its date filter to the CURRENT month, so
    // seed the session inside it (the 15th, at noon UTC to dodge any tz edges).
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const sessionDateStr = `${y}-${m}-15`;

    const [session] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId,
        serviceId,
        sessionDate: new Date(`${sessionDateStr}T12:00:00.000Z`),
        sessionType: "individual",
        status: "completed",
      })
      .returning();
    sessionId = session.id;

    // Bill total is $200 so a $100 statement leaves it partially owed ('billed')
    // and the table renders the "Pay" button (a fully-paid bill shows "Preview").
    const [billing] = await db
      .insert(sessionBilling)
      .values({
        sessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        clientPaidAmount: "0.00",
        insurancePaidAmount: "0.00",
        billingDate: sessionDateStr,
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

    // Create + confirm + post a $100 statement. This records the real insurer
    // $100 against the billing as an insurance payment carrying sourceStatementId
    // — exactly what the dialog's duplicate detector looks for.
    const stmt = await storage.createInsuranceStatement(
      {
        fileName: `stmt-${SUFFIX}.pdf`,
        sourceType: "pdf",
        payerName: `Test Payer ${SUFFIX}`,
        statementDate: sessionDateStr,
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

    const [bAfterPost] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId))
      .limit(1);
    assertEqual(
      Number(bAfterPost.insurancePaidAmount),
      100,
      "Precondition — posting the statement records the real $100 insurance payment",
    );
    assertEqual(
      bAfterPost.paymentStatus,
      "billed",
      "Precondition — the $200 bill is still partially owed ('billed') after the $100 post",
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

    // Open the billing dashboard and the seeded record's Record Payment dialog.
    await page.goto(`${baseUrl}/billing`, { waitUntil: "domcontentloaded" });
    await clickTestId(page, `button-pay-${billingId}`);

    // The dialog form renders the manual Insurance amount input into the drawer.
    await page.waitForSelector('[data-testid="insurance-amount-input"]', {
      timeout: 30_000,
    });

    // --- 1. Key the duplicate $100 → warning shows, submit disabled --------
    await setInputValue(page, "insurance-amount-input", "100");

    // The advisory warning appears once the entered amount matches the posted EOB.
    await page.waitForSelector('[data-testid="duplicate-statement-warning"]', {
      timeout: 30_000,
    });
    assert(
      await warningVisible(page),
      "Keying the duplicate $100 surfaces the duplicate-statement-warning",
    );

    // The submit button must be disabled until the staffer acknowledges.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="record-payment-submit"]',
        ) as HTMLButtonElement | null;
        return !!el && el.disabled === true;
      },
      { timeout: 30_000 },
    );
    assertEqual(
      await isSubmitDisabled(page),
      true,
      "The Record Payment submit button is DISABLED while the duplicate is unacknowledged",
    );

    // --- 2. Tick the override checkbox → submit re-enables ------------------
    await clickTestId(page, "confirm-duplicate-insurance-checkbox");
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="record-payment-submit"]',
        ) as HTMLButtonElement | null;
        return !!el && el.disabled === false;
      },
      { timeout: 30_000 },
    );
    assertEqual(
      await isSubmitDisabled(page),
      false,
      "Ticking confirm-duplicate-insurance-checkbox RE-ENABLES the submit button (override)",
    );
    assert(
      await warningVisible(page),
      "The warning stays visible after override (it informs, the checkbox unblocks)",
    );

    // --- 3. A different top-up amount does NOT trigger the warning ----------
    // Untick the override, then change the amount to a genuinely different $50.
    await clickTestId(page, "confirm-duplicate-insurance-checkbox");
    await setInputValue(page, "insurance-amount-input", "50");

    // The warning disappears for a non-matching amount.
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="duplicate-statement-warning"]'),
      { timeout: 30_000 },
    );
    assert(
      !(await warningVisible(page)),
      "A different ($50 top-up) amount does NOT trigger the duplicate warning",
    );

    // With no duplicate flagged and no overpay ($100 + $50 < $200), submit is enabled.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="record-payment-submit"]',
        ) as HTMLButtonElement | null;
        return !!el && el.disabled === false;
      },
      { timeout: 30_000 },
    );
    assertEqual(
      await isSubmitDisabled(page),
      false,
      "Submit is enabled for the different top-up amount (no duplicate, no overpay)",
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

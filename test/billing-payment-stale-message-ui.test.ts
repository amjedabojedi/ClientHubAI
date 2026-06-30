/**
 * BROWSER-LEVEL test that the payment dialog surfaces a clear, actionable
 * "reopen and re-enter" message when the server rejects a stale payment with
 * HTTP 409 / STALE_PAYMENT_STATE — driven through the real Billing Dashboard
 * PaymentDialog in a real Chromium.
 *
 * WHY THIS SUITE EXISTS
 * The server already protects against two staff recording a payment for the
 * same bill at nearly the same time: the second submit carries the
 * already-paid figure the form READ when it opened (expectedPreviousForSource),
 * and if that figure has since changed the server returns 409 /
 * STALE_PAYMENT_STATE instead of silently overwriting the other payment (proven
 * by test/billing-payment-stale-concurrency.test.ts). But that protection is
 * only useful if the UI tells the user what happened and what to do. If the
 * dialog just showed a generic "something went wrong" — or worse, a misleading
 * "saved" — staff wouldn't know to close and reopen the form to load the latest
 * totals before re-entering. There was no automated coverage that the 409 is
 * mapped to a specific message; this suite locks it in.
 *
 * What it does (in order):
 *   1. Seeds a client + a $200 session billing with $0 collected so the "Pay"
 *      affordance is available and the insurance side starts at $0 already-paid.
 *   2. Opens the Billing Dashboard PaymentDialog for that billing (so the form
 *      reads insuranceAlreadyPaid = 0) and types $50 into the insurance amount.
 *   3. SIMULATES a concurrent payment by another staffer: writes
 *      insurance_paid_amount = 30 directly to the row. The open dialog still
 *      believes 0 was paid, so its submit will carry expectedPreviousForSource=0
 *      against an authoritative 30 → the exact stale condition.
 *   4. Clicks Record Payment and asserts:
 *        - the PUT .../payment returns 409,
 *        - a specific, human-readable message appears naming that the bill was
 *          updated by someone else and to reopen/re-enter,
 *        - NO misleading success ("recorded"/"saved") message appears,
 *        - the dialog is NOT left closed (the form stays open, not in a
 *          fake-saved state).
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper.
 * The app is spawned as a real dev server on an ephemeral port.
 *
 * Run with: npx tsx test/billing-payment-stale-message-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named rows and removes them (and
 *   anything derived) in a finally block.
 * - Must run serially with the other app-level tests (shared dev DB races on
 *   generated identifiers when run concurrently — see
 *   .agents/memory/privacy-test-concurrency.md). Chained into `test-privacy`.
 * - See .agents/memory/browser-tests-puppeteer.md for the auth + Radix patterns
 *   and .agents/memory/payment-cumulative-per-source.md for the stale contract.
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
  paymentTransactions,
} from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

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

const SUFFIX = `stale-pay-msg-ui-${Date.now()}`;

// Replace the value of a controlled <input>: triple-click to select existing
// text, then type the new value so React's onChange fires per keystroke.
async function setInputValue(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value);
}

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
  let adminUserId: number | undefined;
  let therapistId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  let billingId: number | undefined;

  let devServer: DevServer | null = null;
  let browser: Browser | null = null;

  try {
    // --- Seed a $200 billing with $0 collected -----------------------------
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    const adminUser = await storage.createUser({
      username: `admin-${SUFFIX}`,
      password: "x",
      fullName: `Admin ${SUFFIX}`,
      email: `admin-${SUFFIX}@example.test`,
      role: "admin",
    } as any);
    adminUserId = adminUser.id;

    // Insert the client directly with an explicit, unique clientId to avoid the
    // sequential CL-YEAR-NNNN derivation that races other concurrent suites.
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

    // Session dated in the CURRENT month so it falls inside the billing
    // dashboard's default (this-month) date range without changing filters.
    const now = new Date();
    const sessionDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10, 10, 0, 0),
    );
    const billingDateStr = sessionDate.toISOString().split("T")[0];

    const [session] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId,
        serviceId,
        sessionDate,
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
        ratePerUnit: "200.00",
        totalAmount: "200.00",
        clientPaidAmount: "0.00",
        insurancePaidAmount: "0.00",
        billingDate: billingDateStr,
        paymentStatus: "pending",
      })
      .returning();
    billingId = billing.id;

    // --- Browser flow ------------------------------------------------------
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;
    browser = await launchBrowser();

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await loginAs(page, {
      username: adminUser.username,
      password: "x",
    });
    assertEqual(loginStatus, 200, "Admin user logs in via /api/auth/login");

    await page.goto(`${baseUrl}/billing-dashboard`, {
      waitUntil: "domcontentloaded",
    });

    // Open the Pay dialog for the seeded billing. At this moment the dialog
    // reads insuranceAlreadyPaid = 0 from the row.
    await page.waitForSelector(`[data-testid="button-pay-${billingId}"]`, {
      timeout: 60_000,
    });
    await clickTestId(page, `button-pay-${billingId}`);

    // Enter $50 on the INSURANCE side (method defaults to "insurance" and the
    // date defaults to today, so the form is submittable with no further input).
    await page.waitForSelector('[data-testid="insurance-amount-input"]', {
      timeout: 30_000,
    });
    await setInputValue(page, '[data-testid="insurance-amount-input"]', "50");

    // SIMULATE a concurrent payment by another staffer landing AFTER the dialog
    // opened: the authoritative insurance-paid total is now 30, but the open
    // form still believes it is 0. Its submit will carry
    // expectedPreviousForSource = 0, which the server rejects as stale.
    await db
      .update(sessionBilling)
      .set({ insurancePaidAmount: "30.00" })
      .where(eq(sessionBilling.id, billingId));

    // Click Record Payment and capture the rejected PUT.
    const [payResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes(`/api/billing/${billingId}/payment`) &&
          res.request().method() === "PUT",
        { timeout: 30_000 },
      ),
      clickTestId(page, "record-payment-submit"),
    ]);
    assertEqual(
      payResp.status(),
      409,
      "Submitting the stale payment fires PUT .../payment that the server rejects with 409",
    );

    // The user SEES a specific, actionable message — not a generic error.
    await page.waitForFunction(
      () => document.body.innerText.includes("Bill was updated by someone else"),
      { timeout: 10_000 },
    );
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(
      bodyText.includes("Bill was updated by someone else"),
      'A specific "Bill was updated by someone else" message appears when the stale payment is rejected',
    );
    assert(
      /reopen the payment form/i.test(bodyText),
      "The message tells the user to reopen the payment form (so they load the latest totals)",
    );
    assert(
      /re-enter/i.test(bodyText),
      "The message tells the user to re-enter the payment",
    );

    // The UI must NOT pretend the payment succeeded.
    assert(
      !/payment recorded successfully/i.test(bodyText) &&
        !/2 payments recorded/i.test(bodyText) &&
        !/payments? recorded\b/i.test(bodyText),
      "No misleading success message is shown for the rejected payment",
    );

    // The dialog is NOT left closed in a fake-saved state — the form stays open
    // so the user can read the message and act on it.
    const dialogStillOpen = await page.evaluate(
      () => !!document.querySelector('[data-testid="record-payment-submit"]'),
    );
    assert(
      dialogStillOpen,
      "The payment dialog stays open after the rejection (not silently closed as if saved)",
    );

    // And the rejected payment never landed: the stale $50 was not written, the
    // authoritative $30 stands.
    const [after] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId))
      .limit(1);
    assertEqual(
      Number(after.insurancePaidAmount),
      30,
      "The rejected payment was not applied — the authoritative $30 stands, the stale $50 was dropped",
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
      const userIds = [therapistId, adminUserId].filter(
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

/**
 * BROWSER-LEVEL test that the CLIENT-PROFILE Billing tab "Record Payment"
 * mini-form surfaces the clear, actionable "Bill was updated by someone else"
 * message when the server rejects a stale payment with HTTP 409 /
 * STALE_PAYMENT_STATE — driven through a real Chromium against a real dev
 * server.
 *
 * WHY THIS SUITE EXISTS
 * The sibling suite test/billing-payment-stale-message-ui.test.ts already locks
 * in the specific reopen/re-enter message for the Billing Dashboard
 * PaymentDialog. But the client-profile Billing tab mini-form
 * (client/src/pages/client-detail.tsx) is a SEPARATE surface with its OWN
 * mutation (updatePaymentStatusMutation) and its own onError handler. It could
 * regress independently — losing the specific message and falling back to a
 * generic "something went wrong", or worse a misleading "saved" — without the
 * dashboard test ever noticing. This suite gives that second surface the same
 * coverage so both stay honest.
 *
 * What it does (in order):
 *   1. Seeds a client + a $200 PENDING session billing with $0 collected so the
 *      Billing tab shows a "Pay" button and the client side starts at $0
 *      already-paid.
 *   2. Opens the client-profile Billing tab, clicks "Pay" to open the Record
 *      Payment mini-form (so the form reads clientAlreadyPaid = 0), and types
 *      $50 into the amount (source defaults to "Client").
 *   3. SIMULATES a concurrent payment by another staffer: writes
 *      client_paid_amount = 30 directly to the row. The open form still believes
 *      0 was paid, so its submit will carry expectedPreviousForSource = 0
 *      against an authoritative 30 → the exact stale condition.
 *   4. Clicks Record Payment and asserts:
 *        - the PUT .../payment returns 409,
 *        - the specific "Bill was updated by someone else" + reopen/re-enter
 *          message appears,
 *        - NO misleading success ("recorded"/"saved") message appears,
 *        - the mini-form is NOT left closed (stays open, not fake-saved),
 *        - the rejected $50 never landed — the authoritative $30 stands.
 *
 * Auth + server wiring mirror the sibling browser suites exactly (see
 * test/helpers/browser.ts and .agents/memory/browser-tests-puppeteer.md).
 *
 * Run with: npx tsx test/client-detail-payment-stale-message-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named rows and removes them (and
 *   anything derived) in a finally block.
 * - Must run serially with the other app-level tests (shared dev DB races on
 *   generated identifiers when run concurrently — see
 *   .agents/memory/privacy-test-concurrency.md). Chained into `test-privacy`.
 * - See .agents/memory/payment-cumulative-per-source.md for the stale contract.
 */

import type { Browser, Page } from "puppeteer";
import {
  startDevServer,
  launchBrowser,
  loginAs,
  clickButtonByText,
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

const SUFFIX = `cd-stale-pay-msg-ui-${Date.now()}`;
const DRAWER = '[data-testid="record-drawer"]';

// Replace the value of a controlled <input>: triple-click to select existing
// text, then type the new value so React's onChange fires per keystroke.
async function setInputValue(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value);
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
    // --- Seed a $200 PENDING billing with $0 collected --------------------
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

    // Open the client profile straight to the Billing tab.
    await page.goto(`${baseUrl}/clients/${clientId}?tab=billing`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('[role="tablist"], main, body', {
      timeout: 30_000,
    });

    // Click "Pay" on the seeded pending billing → opens the Record Payment
    // mini-form. At this moment the form reads clientAlreadyPaid = 0.
    await clickButtonByText(page, /^Pay$/);
    await page.waitForFunction(
      (sel: string) =>
        !!document.querySelector(sel) &&
        !!document.querySelector("#payment-amount"),
      { timeout: 30_000 },
      DRAWER,
    );

    // Enter $50 on the CLIENT side (source defaults to "Client").
    await setInputValue(page, "#payment-amount", "50");

    // SIMULATE a concurrent payment by another staffer landing AFTER the form
    // opened: the authoritative client-paid total is now 30, but the open form
    // still believes it is 0. Its submit will carry expectedPreviousForSource =
    // 0, which the server rejects as stale.
    await db
      .update(sessionBilling)
      .set({ clientPaidAmount: "30.00" })
      .where(eq(sessionBilling.id, billingId));

    // Click Record Payment and capture the rejected PUT.
    const [payResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes(`/api/billing/${billingId}/payment`) &&
          res.request().method() === "PUT",
        { timeout: 30_000 },
      ),
      clickButtonByText(page, /^Record Payment$/, DRAWER),
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
        !/payment details have been updated/i.test(bodyText) &&
        !/payments? recorded\b/i.test(bodyText),
      "No misleading success message is shown for the rejected payment",
    );

    // The mini-form is NOT left closed in a fake-saved state — it stays open so
    // the user can read the message and act on it.
    const formStillOpen = await page.evaluate(
      () => !!document.querySelector("#payment-amount"),
    );
    assert(
      formStillOpen,
      "The payment mini-form stays open after the rejection (not silently closed as if saved)",
    );

    // And the rejected payment never landed: the stale $50 was not written, the
    // authoritative $30 stands.
    const [after] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId))
      .limit(1);
    assertEqual(
      Number(after.clientPaidAmount),
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

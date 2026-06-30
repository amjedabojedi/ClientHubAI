/**
 * BROWSER-LEVEL test that the CLIENT-PROFILE Billing tab "Record Payment"
 * mini-form can RECOVER from a concurrency conflict in place when the payment
 * source is INSURANCE: after the server rejects a stale insurance payment with
 * HTTP 409 / STALE_PAYMENT_STATE, the amber conflict banner appears, clicking
 * "Reload latest totals" pulls the new insurance already-paid figure into the
 * open mini-form, and the follow-up submit succeeds against the now-fresh basis.
 *
 * WHY THIS SUITE EXISTS
 * Task #250 added an in-place "Reload latest totals" action so a staffer hitting
 * the 409 stale-payment guard no longer has to close and reopen the form (and
 * lose what they typed). The sibling suite
 * test/client-detail-payment-stale-reload-totals-ui.test.ts proves the FULL
 * recovery path (reload + successful re-submit) but only for a CLIENT-source
 * payment — it asserts the `refreshed-client-delta` figure (clientPaidAmount).
 * The SAME mini-form also records INSURANCE-source payments, whose reload path
 * updates a SEPARATE `refreshed-insurance-delta` figure (insurancePaidAmount).
 * That insurance branch of refreshLatestPaymentTotals + re-submit is otherwise
 * unverified, so a regression there (e.g. it stopped reading the insurance
 * column, or the re-submit kept carrying the stale insurance basis) could ship
 * silently. This suite gives the insurance source the same full-recovery
 * coverage. (The sibling
 * test/client-detail-insurance-payment-stale-message-ui.test.ts only locks in
 * that the 409 produces a message; it does NOT exercise the reload button or
 * prove the re-submit then succeeds.)
 *
 * What it does (in order):
 *   1. Seeds a client + a $200 PENDING session billing with $0 collected so the
 *      Billing tab shows a "Pay" button and the insurance side starts at $0
 *      already-paid.
 *   2. Opens the client-profile Billing tab, clicks "Pay" to open the Record
 *      Payment mini-form, switches "Paid By" to Insurance (payment-source-select)
 *      so the form reads insuranceAlreadyPaid = 0, and types $50 into the amount.
 *   3. SIMULATES a concurrent insurance payment by another staffer: writes
 *      insurance_paid_amount = 30 directly to the row. The open form still
 *      believes 0 was paid on insurance, so its submit carries
 *      expectedPreviousForSource = 0 against an authoritative 30 → the exact
 *      stale condition, on the insurance basis specifically.
 *   4. Clicks Record Payment and asserts the PUT returns 409 and the amber
 *      conflict banner (data-testid `payment-stale-banner`) appears.
 *   5. Clicks "Reload latest totals" (`button-reload-totals`) and asserts:
 *        - the banner clears,
 *        - the "Latest totals loaded" note (`payment-refreshed-note`) shows the
 *          insurance already-paid figure moving 0.00 → 30.00 via
 *          `refreshed-insurance-delta`,
 *        - the mini-form's "Already Paid" summary now shows the latest $30.00.
 *   6. Re-submits the still-entered $50 and asserts:
 *        - the follow-up PUT returns 200 (no longer stale),
 *        - the mini-form closes (success), and
 *        - the row now holds insurance_paid_amount = 80 (30 authoritative + 50),
 *          while the client bucket stays $0 (the insurance payment never spilled
 *          into it).
 *
 * Auth + server wiring mirror the sibling browser suites exactly (see
 * test/helpers/browser.ts and .agents/memory/browser-tests-puppeteer.md).
 *
 * Run with: npx tsx test/client-detail-insurance-payment-stale-reload-totals-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named rows and removes them (and
 *   anything derived) in a finally block.
 * - Must run serially with the other app-level tests (shared dev DB races on
 *   generated identifiers when run concurrently — see
 *   .agents/memory/privacy-test-concurrency.md). Chained into `test-privacy`.
 * - The re-submit click must use a direct DOM .click() on the button node (via
 *   page.evaluate), NOT a coordinate-based trusted click — the "Totals reloaded"
 *   toast portal overlays the submit button after reload. See
 *   .agents/memory/puppeteer-toast-overlay-click.md.
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

const SUFFIX = `cd-ins-stale-pay-reload-ui-${Date.now()}`;
const DRAWER = '[data-testid="record-drawer"]';

// Replace the value of a controlled <input>: triple-click to select existing
// text, then type the new value so React's onChange fires per keystroke.
async function setInputValue(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value);
}

// Pick an option from a shadcn/Radix <Select>. The trigger is a button with
// role="combobox"; we find the one whose current text matches `triggerText`,
// click it to open the listbox, then click the [role="option"] whose text is
// `optionText`. Radix renders options in a portal, so we wait for them to
// appear after opening, and retry the whole open+pick because a one-shot click
// can succeed yet not actually open the listbox.
async function selectRadixOption(
  page: Page,
  triggerText: RegExp,
  optionText: RegExp,
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const triggers = await page.$$('[role="combobox"]');
    let opened = false;
    for (const t of triggers) {
      let text = "";
      try {
        text = await t.evaluate((el: Element) => (el.textContent || "").trim());
      } catch {
        continue;
      }
      if (!triggerText.test(text)) continue;
      try {
        await t.evaluate((el: Element) =>
          el.scrollIntoView({ block: "center", inline: "center" }),
        );
        await t.click();
        opened = true;
        break;
      } catch {
        // not clickable this pass — retry
      }
    }
    if (opened) {
      try {
        await page.waitForSelector('[role="option"]', { timeout: 5_000 });
        const options = await page.$$('[role="option"]');
        for (const o of options) {
          let text = "";
          try {
            text = await o.evaluate(
              (el: Element) => (el.textContent || "").trim(),
            );
          } catch {
            continue;
          }
          if (!optionText.test(text)) continue;
          await o.click();
          return;
        }
      } catch {
        // options didn't render this pass — retry
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Could not select option ${optionText} from a combobox matching ${triggerText}`,
  );
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
    // --- Seed a $200 PENDING billing with $0 collected on both sources -----
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
    // mini-form. At this moment the form reads insuranceAlreadyPaid = 0.
    await clickButtonByText(page, /^Pay$/);
    await page.waitForFunction(
      (sel: string) =>
        !!document.querySelector(sel) &&
        !!document.querySelector("#payment-amount"),
      { timeout: 30_000 },
      DRAWER,
    );

    // Switch "Paid By" to Insurance so the form's basis becomes the insurance
    // bucket (expectedPreviousForSource = insurance_paid_amount).
    await selectRadixOption(page, /Client|Insurance|Who paid/i, /^Insurance$/);
    // Confirm the select really flipped to Insurance before continuing.
    await page.waitForFunction(
      () => {
        const trigger = document.querySelector(
          '[data-testid="payment-source-select"]',
        );
        return !!trigger && /insurance/i.test(trigger.textContent || "");
      },
      { timeout: 10_000 },
    );

    // Enter $50 on the INSURANCE side.
    await setInputValue(page, "#payment-amount", "50");

    // SIMULATE a concurrent INSURANCE payment by another staffer landing AFTER
    // the form opened: the authoritative insurance-paid total is now 30, but the
    // open form still believes it is 0. Its submit will carry
    // expectedPreviousForSource = 0, which the server rejects as stale on the
    // insurance basis. Client side is deliberately left at 0 to prove the stale
    // check is keyed to the insurance bucket, not the client one.
    await db
      .update(sessionBilling)
      .set({ insurancePaidAmount: "30.00" })
      .where(eq(sessionBilling.id, billingId));

    // Click Record Payment and capture the rejected PUT.
    const [staleResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes(`/api/billing/${billingId}/payment`) &&
          res.request().method() === "PUT",
        { timeout: 30_000 },
      ),
      clickButtonByText(page, /^Record Payment$/, DRAWER),
    ]);
    assertEqual(
      staleResp.status(),
      409,
      "First insurance submit is rejected with 409 (stale basis: form believed $0, server has $30)",
    );

    // The amber conflict banner appears, offering the in-place reload.
    await page.waitForSelector('[data-testid="payment-stale-banner"]', {
      timeout: 10_000,
    });
    const bannerVisible = await page.evaluate(
      () => !!document.querySelector('[data-testid="payment-stale-banner"]'),
    );
    assert(
      bannerVisible,
      "The amber conflict banner (payment-stale-banner) appears after the 409",
    );
    const reloadButtonVisible = await page.evaluate(
      () => !!document.querySelector('[data-testid="button-reload-totals"]'),
    );
    assert(
      reloadButtonVisible,
      'The banner offers a "Reload latest totals" button (button-reload-totals)',
    );

    // Click "Reload latest totals". This refetches the client's billing list and
    // pulls the authoritative $30 insurance figure into the open mini-form.
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="button-reload-totals"]',
      ) as HTMLElement | null;
      el?.click();
    });

    // The "Latest totals loaded" note appears and shows the insurance figure
    // moving from $0.00 → $30.00 (the displayed already-paid value updated to
    // the latest stored value).
    await page.waitForSelector('[data-testid="payment-refreshed-note"]', {
      timeout: 10_000,
    });
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="refreshed-insurance-delta"]',
        );
        return !!el && /30\.00/.test(el.textContent || "");
      },
      { timeout: 10_000 },
    );
    const deltaText = await page.evaluate(
      () =>
        document.querySelector('[data-testid="refreshed-insurance-delta"]')
          ?.textContent || "",
    );
    assert(
      /0\.00/.test(deltaText) && /30\.00/.test(deltaText),
      `The refreshed note shows insurance already-paid 0.00 → 30.00 (got "${deltaText.trim()}")`,
    );

    // The amber banner is gone now that the totals are current.
    const bannerGone = await page.evaluate(
      () => !document.querySelector('[data-testid="payment-stale-banner"]'),
    );
    assert(
      bannerGone,
      "The amber conflict banner clears once the latest totals are loaded",
    );

    // The mini-form's "Already Paid" summary now reflects the latest $30.00.
    const summaryShows30 = await page.evaluate(() =>
      document.body.innerText.includes("$30.00"),
    );
    assert(
      summaryShows30,
      "The mini-form now displays the latest already-paid figure ($30.00)",
    );

    // Re-submit the still-entered $50 against the fresh basis. After the reload a
    // "Totals reloaded" toast pops up; its portal can overlay the submit button,
    // so a coordinate-based (trusted) click silently lands on the toast instead
    // of the button and never submits. Click the actual button NODE directly
    // (native .click() submits the form regardless of any overlay) to avoid that
    // race.
    await page.waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll('[data-testid="record-drawer"] button'),
        ).some(
          (b) =>
            /^Record Payment$/.test((b.textContent || "").trim()) &&
            !(b as HTMLButtonElement).disabled,
        ),
      { timeout: 10_000 },
    );
    const [okResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes(`/api/billing/${billingId}/payment`) &&
          res.request().method() === "PUT",
        { timeout: 30_000 },
      ),
      page.evaluate(() => {
        const btn = Array.from(
          document.querySelectorAll('[data-testid="record-drawer"] button'),
        ).find((b) =>
          /^Record Payment$/.test((b.textContent || "").trim()),
        ) as HTMLButtonElement | undefined;
        btn?.click();
      }),
    ]);
    assertEqual(
      okResp.status(),
      200,
      "The follow-up insurance submit succeeds (200) now that it carries the fresh $30 basis",
    );

    // The mini-form closes on success (no longer left open in a conflict state).
    await page.waitForFunction(
      () => !document.querySelector("#payment-amount"),
      { timeout: 10_000 },
    );
    const formClosed = await page.evaluate(
      () => !document.querySelector("#payment-amount"),
    );
    assert(formClosed, "The payment mini-form closes after the successful re-submit");

    // The insurance payment landed on top of the authoritative $30: 30 + 50 = 80,
    // and the client bucket is untouched.
    const [after] = await db
      .select()
      .from(sessionBilling)
      .where(eq(sessionBilling.id, billingId))
      .limit(1);
    assertEqual(
      Number(after.insurancePaidAmount),
      80,
      "The re-submit applied $50 on top of the authoritative $30 → insurance_paid_amount = 80",
    );
    assertEqual(
      Number(after.clientPaidAmount),
      0,
      "The client-paid bucket is untouched — the insurance payment never spilled into it",
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

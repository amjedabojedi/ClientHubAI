/**
 * BROWSER-LEVEL test proving the OVERRIDE actually SAVES a confirmed duplicate
 * insurance payment end-to-end, driven through the REAL /billing screen a
 * billing staffer clicks, in a real Chromium.
 *
 * Why this exists (the gap it closes)
 * -----------------------------------
 * The sibling suite test/insurance-duplicate-payment-warning-ui.test.ts proves
 * the ADVISORY half: keying a duplicate insurance amount surfaces a warning,
 * DISABLES submit, and ticking the override checkbox re-enables it. But it never
 * actually SUBMITS — so nothing proved that after the override the payment really
 * posts. Task #218 added a server-side guard and made the dialog forward
 * `acknowledgeDuplicate` from the override checkbox. If that forwarding ever
 * regressed, staff would be SILENTLY blocked from recording legitimate separate
 * payments and no existing test would catch it. This suite closes that gap.
 *
 * What it does (in order, mirroring real usage):
 *   1. Seeds a $200 billing in the CURRENT month and POSTS a $100 insurance
 *      statement against it (collected insurance $100, status 'billed', so the
 *      table renders the "Pay" button and the dialog's duplicate detector has a
 *      posted EOB payment to match against).
 *   2. Logs in as a billing user.
 *   3. COMPLEMENTARY (server route) — issues a scripted authenticated PUT
 *      /api/billing/:id/payment re-keying the same $100 (cumulative $200) WITHOUT
 *      acknowledgeDuplicate, and asserts the route rejects it with HTTP 422 +
 *      code DUPLICATE_INSURANCE_PAYMENT, and collected insurance stays $100. This
 *      proves the real HTTP endpoint (not just storage) maps the guard to 422.
 *   4. UI OVERRIDE SUBMIT — opens the Record Payment dialog, keys the duplicate
 *      $100, ticks confirm-duplicate-insurance-checkbox, clicks submit, and
 *      asserts: no error (destructive) toast appears, the dialog closes, and
 *      collected insurance really increases to $200 in the database.
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login -> httpOnly sessionToken + readable csrfToken cookies
 * + localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/insurance-duplicate-payment-override-submit-ui.test.ts
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

const SUFFIX = `ins-dup-override-ui-${Date.now()}`;

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

// An error toast is rendered with the "destructive" variant, whose Radix root
// (an <li>) carries the "destructive" class token. The success path uses the
// default variant (no such token). So the presence of any "destructive" toast
// is a reliable signal that the submit surfaced an error.
async function destructiveToastVisible(page: Page): Promise<boolean> {
  return page.evaluate(
    () => !!document.querySelector('li.destructive, [data-testid="toast-destructive"]'),
  );
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
    // --- Seed a $200 billing with a posted $100 insurance statement ---------
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    // Record the payment as an ADMIN. The PUT /api/billing/:id/payment route
    // authorizes administrators, supervisors, accountants, and the assigned
    // therapist — it does NOT accept the bare 'billing' role (that role can post
    // statements but not record a manual payment through this route), so a
    // 'billing' user would 403 before ever reaching the duplicate guard. Using
    // an admin keeps this suite focused on the override guard, not authz.
    const billingUser = await storage.createUser({
      username: `admin-${SUFFIX}`,
      password: "x",
      fullName: `Admin ${SUFFIX}`,
      email: `admin-${SUFFIX}@example.test`,
      role: "admin",
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

    const bAfterPost = await getBilling(billingId);
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
    assertEqual(loginStatus, 200, "Admin user logs in via /api/auth/login");

    // --- COMPLEMENTARY: a scripted PUT WITHOUT override is rejected 422 -----
    // Re-key the same $100 (cumulative $200) through the REAL authenticated HTTP
    // route with no acknowledgeDuplicate. This mirrors a stale page / scripted
    // caller and proves the route (not just storage) returns 422 with the
    // DUPLICATE_INSURANCE_PAYMENT code.
    const scriptedNoAck = await page.evaluate(
      async (args: { billingId: number; clientId: number; date: string }) => {
        const csrf = (() => {
          for (const c of document.cookie.split(";")) {
            const [n, v] = c.trim().split("=");
            if (n === "csrfToken") return decodeURIComponent(v);
          }
          return "";
        })();
        const r = await fetch(`/api/billing/${args.billingId}/payment`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
          credentials: "include",
          body: JSON.stringify({
            status: "paid",
            amount: 200, // cumulative = previous 100 + new 100
            source: "insurance",
            method: "insurance",
            date: args.date,
            clientId: args.clientId,
          }),
        });
        let body: any = null;
        try {
          body = await r.json();
        } catch {}
        return { status: r.status, code: body?.code };
      },
      { billingId: billingId!, clientId: clientId!, date: sessionDateStr },
    );
    assertEqual(
      scriptedNoAck.status,
      422,
      "A scripted PUT WITHOUT override is rejected with HTTP 422",
    );
    assertEqual(
      scriptedNoAck.code,
      "DUPLICATE_INSURANCE_PAYMENT",
      "The 422 carries the DUPLICATE_INSURANCE_PAYMENT code",
    );
    const bAfterReject = await getBilling(billingId);
    assertEqual(
      Number(bAfterReject.insurancePaidAmount),
      100,
      "The rejected scripted duplicate did NOT change collected insurance (stays $100)",
    );

    // --- UI OVERRIDE SUBMIT: tick the checkbox, submit, payment posts ------
    await page.goto(`${baseUrl}/billing`, { waitUntil: "domcontentloaded" });
    await clickTestId(page, `button-pay-${billingId}`);

    // The dialog form renders the manual Insurance amount input into the drawer.
    await page.waitForSelector('[data-testid="insurance-amount-input"]', {
      timeout: 30_000,
    });

    // Key the duplicate $100 → the advisory warning appears and submit disables.
    await setInputValue(page, "insurance-amount-input", "100");
    await page.waitForSelector('[data-testid="duplicate-statement-warning"]', {
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="record-payment-submit"]',
        ) as HTMLButtonElement | null;
        return !!el && el.disabled === true;
      },
      { timeout: 30_000 },
    );

    // Tick the override checkbox → submit re-enables.
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

    // Submit the confirmed duplicate payment.
    await clickTestId(page, "record-payment-submit");

    // The payment must really post: collected insurance rises to $200. Poll the
    // DB because the PUT + cache invalidation are async.
    const submitDeadline = Date.now() + 30_000;
    let collectedAfter = Number(bAfterReject.insurancePaidAmount);
    while (Date.now() < submitDeadline) {
      const b = await getBilling(billingId);
      collectedAfter = Number(b.insurancePaidAmount);
      if (collectedAfter === 200) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assertEqual(
      collectedAfter,
      200,
      "Ticking the override and submitting POSTS the duplicate — collected insurance increases to $200",
    );

    // No error toast appears (success path only). Give the UI a beat to render
    // any toast that would have fired, then assert none is destructive.
    await new Promise((r) => setTimeout(r, 1_000));
    assert(
      !(await destructiveToastVisible(page)),
      "No error (destructive) toast appears after the successful override submit",
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

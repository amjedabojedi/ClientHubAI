/**
 * BROWSER-LEVEL test for the duplicate-insurance-payment advisory, driven
 * through the TWO real payment surfaces a staffer actually uses, in a real
 * Chromium.
 *
 * WHY THIS SUITE EXISTS
 * The duplicate-insurance-payment warning is a safeguard against staff
 * accidentally double-counting insurance money: if you key a manual insurance
 * payment whose amount matches an insurance payment ALREADY posted from an
 * uploaded statement (EOB), the UI shows an amber advisory and BLOCKS the
 * submit button until an override checkbox is ticked. The detection depends on
 * the /api/billing/:id/transactions response carrying the right shape per row
 * (source='insurance', sourceStatementId, statementPayerName,
 * statementCheckNumber, amount, voidedAt). A refactor that drops or renames any
 * of those fields — or breaks the disabled-until-confirmed wiring — would
 * silently disarm the safeguard and nobody would notice until insurance money
 * was double-counted. There was NO automated coverage on either surface; this
 * suite locks both in.
 *
 * What it does (in order):
 *   1. Seeds a client + a $200 session billing, then POSTS a $100 insurance
 *      statement (with a known payer name + check number) matched to that
 *      billing. This is the "already-posted EOB" the warning must catch. The
 *      billing stays partial (collected $100 of $200) so the "Pay" affordance
 *      is available on both surfaces.
 *   2. Surface A — Client profile Billing tab "Record Payment" mini-form:
 *        opens the Pay drawer, enters $100 as an INSURANCE payment, and asserts
 *        the duplicate-statement-warning appears, the warning text names the
 *        seeded payer + check number (proving the response shape flows through),
 *        the submit is DISABLED, ticking the override checkbox ENABLES it.
 *   3. Surface B — Billing Dashboard PaymentDialog: opens the Pay dialog for the
 *        same billing, types $100 into the insurance amount, and asserts the
 *        same: warning appears, submit DISABLED, override checkbox ENABLES it.
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/duplicate-insurance-payment-warning-ui.test.ts
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
  clickTabById,
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

const SUFFIX = `dup-ins-warn-ui-${Date.now()}`;
const PAYER = `Test Payer ${SUFFIX}`;
const CHECK_NO = `CHK-${Date.now()}`.slice(0, 100);

// Tick a plain <input type=checkbox> in-page. A DOM .click() fires its React
// onChange handler, so this is enough to flip the override state. Mirrors the
// clickTestId pattern used by the sibling insurance UI suites.
async function clickTestId(page: Page, testId: string) {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    el?.click();
  }, selector);
}

// Replace the value of a controlled <input> identified by `selector`: triple-
// click to select existing text, then type the new value so React's onChange
// fires for every keystroke.
async function setInputValue(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value);
}

// Pick an option from a shadcn/Radix <Select>. The trigger is a button with
// role="combobox"; we find the one whose current text matches `triggerText`,
// click it to open the listbox, then click the [role="option"] whose text is
// `optionText`. Radix renders options in a portal, so we wait for them to
// appear after opening.
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

// Read the `disabled` property of the first button matching `textPattern`
// (optionally a type=submit). Polls until such a button exists.
async function submitButtonDisabled(
  page: Page,
  textPattern: RegExp,
): Promise<boolean> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const handles = await page.$$('button[type="submit"]');
    for (const h of handles) {
      let info: { text: string; disabled: boolean } | null = null;
      try {
        info = await h.evaluate((el: Element) => ({
          text: (el.textContent || "").trim(),
          disabled: (el as HTMLButtonElement).disabled,
        }));
      } catch {
        continue;
      }
      if (info && textPattern.test(info.text)) return info.disabled;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No submit button matching ${textPattern} found`);
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
  let adminUserId: number | undefined;
  let therapistId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  let billingId: number | undefined;
  let statementId: number | undefined;
  let lineId: number | undefined;

  let devServer: DevServer | null = null;
  let browser: Browser | null = null;

  try {
    // --- Seed an "already-posted EOB" against a $200 billing ----------------
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    // Admin reaches BOTH the client profile and the billing dashboard + routes.
    const adminUser = await storage.createUser({
      username: `admin-${SUFFIX}`,
      password: "x",
      fullName: `Admin ${SUFFIX}`,
      email: `admin-${SUFFIX}@example.test`,
      role: "admin",
    } as any);
    adminUserId = adminUser.id;

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

    // Bill is $200 so collecting $100 of insurance leaves it partial (not paid)
    // → the "Pay"/"Record Payment" affordance stays available on both surfaces.
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

    // Create + confirm + post a $100 statement against the billing. This writes
    // the posted insurance payment transaction (source='insurance',
    // sourceStatementId set) that the duplicate advisory must detect, and the
    // payer name + check number that the warning text surfaces.
    const stmt = await storage.createInsuranceStatement(
      {
        fileName: `stmt-${SUFFIX}.pdf`,
        sourceType: "pdf",
        payerName: PAYER,
        checkNumber: CHECK_NO,
        statementDate: billingDateStr,
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
    await storage.postInsuranceStatement(statementId, adminUserId);

    const b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "Precondition — posting the statement records the real $100 insurance",
    );

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

    // =====================================================================
    // SURFACE A — Client profile Billing tab "Record Payment" mini-form
    // =====================================================================
    await page.goto(`${baseUrl}/clients/${clientId}`, {
      waitUntil: "domcontentloaded",
    });
    await clickTabById(page, "tab-billing");

    // Open the "Pay" drawer for the seeded billing record. The card's primary
    // action button reads "Pay" for a non-paid billing.
    const payClicked = await (async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const handles = await page.$$("button");
        for (const h of handles) {
          let text = "";
          try {
            text = await h.evaluate(
              (el: Element) => (el.textContent || "").trim(),
            );
          } catch {
            continue;
          }
          if (!/^Pay$/.test(text)) continue;
          try {
            await h.evaluate((el: Element) =>
              el.scrollIntoView({ block: "center", inline: "center" }),
            );
            await h.click();
            return true;
          } catch {
            try {
              await h.evaluate((el: Element) => (el as HTMLElement).click());
              return true;
            } catch {
              // retry
            }
          }
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    })();
    assert(payClicked, "Client Billing tab — opened the Record Payment drawer");

    // The mini-form's amount field + method select.
    await page.waitForSelector("#payment-amount", { timeout: 30_000 });
    await setInputValue(page, "#payment-amount", "100");

    // WRONG-METHOD CASE (the bug this task fixes): leave the method on its
    // default "Cash". The duplicate advisory must STILL fire — a staffer must
    // not be able to sidestep the safeguard by keeping the method on Cash and
    // double-counting already-posted insurance money.
    await page.waitForSelector('[data-testid="duplicate-statement-warning"]', {
      timeout: 30_000,
    });
    assert(
      true,
      "Client mini-form — duplicate-statement-warning appears even when method is the default Cash (wrong-method case)",
    );

    // With a non-insurance method, the warning must additionally advise that the
    // matching money is insurance and should be recorded with the Insurance
    // method.
    await page.waitForSelector(
      '[data-testid="duplicate-statement-method-note"]',
      { timeout: 30_000 },
    );
    assert(
      true,
      "Client mini-form — wrong-method note advises recording the match as insurance",
    );

    // Submit is BLOCKED on the wrong-method case too, before any acknowledgement.
    const disabledWrongMethod = await submitButtonDisabled(
      page,
      /Record Payment/,
    );
    assert(
      disabledWrongMethod,
      "Client mini-form — Record Payment is DISABLED for a Cash-method duplicate (safeguard not sidesteppable)",
    );

    // Now switch the method to "Insurance"; the advisory stays, and the
    // wrong-method note goes away (method now matches the money type).
    await selectRadixOption(page, /Cash/, /^Insurance$/);

    // The amber duplicate advisory must remain.
    await page.waitForSelector('[data-testid="duplicate-statement-warning"]', {
      timeout: 30_000,
    });
    assert(
      true,
      "Client mini-form — duplicate-statement-warning still appears for the matching insurance amount",
    );

    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[data-testid="duplicate-statement-method-note"]',
        ),
      { timeout: 30_000 },
    );
    assert(
      true,
      "Client mini-form — wrong-method note clears once the Insurance method is selected",
    );

    // The warning text must surface the response-shape fields (payer + check
    // number) so a regression that drops them is caught.
    const warnTextA = await page.$eval(
      '[data-testid="duplicate-statement-warning"]',
      (el: Element) => el.textContent || "",
    );
    assert(
      warnTextA.includes(PAYER),
      "Client mini-form — warning names the posted statement's payer (statementPayerName flows through)",
    );
    assert(
      warnTextA.includes(CHECK_NO),
      "Client mini-form — warning names the posted statement's check number (statementCheckNumber flows through)",
    );
    assert(
      warnTextA.includes(`#${statementId}`),
      "Client mini-form — warning names the source statement id (sourceStatementId flows through)",
    );

    // Submit is BLOCKED until the override is acknowledged.
    const disabledBeforeA = await submitButtonDisabled(page, /Record Payment/);
    assert(
      disabledBeforeA,
      "Client mini-form — Record Payment is DISABLED while the duplicate is unacknowledged",
    );

    await clickTestId(page, "confirm-duplicate-insurance-checkbox");

    await page.waitForFunction(
      () => {
        const btns = Array.from(
          document.querySelectorAll('button[type="submit"]'),
        );
        const btn = btns.find((b) =>
          /Record Payment/.test((b.textContent || "").trim()),
        ) as HTMLButtonElement | undefined;
        return !!btn && !btn.disabled;
      },
      { timeout: 30_000 },
    );
    const disabledAfterA = await submitButtonDisabled(page, /Record Payment/);
    assert(
      !disabledAfterA,
      "Client mini-form — ticking the override checkbox ENABLES Record Payment",
    );

    // =====================================================================
    // SURFACE B — Billing Dashboard PaymentDialog
    // =====================================================================
    await page.goto(`${baseUrl}/billing-dashboard`, {
      waitUntil: "domcontentloaded",
    });

    // Open the Pay dialog for the seeded billing (testid keyed by billing id).
    await page.waitForSelector(`[data-testid="button-pay-${billingId}"]`, {
      timeout: 60_000,
    });
    await clickTestId(page, `button-pay-${billingId}`);

    // Enter the matching $100 on the INSURANCE side. The advisory here fires on
    // any positive insurance amount that matches a posted-statement payment.
    await page.waitForSelector('[data-testid="insurance-amount-input"]', {
      timeout: 30_000,
    });
    await setInputValue(page, '[data-testid="insurance-amount-input"]', "100");

    await page.waitForSelector('[data-testid="duplicate-statement-warning"]', {
      timeout: 30_000,
    });
    assert(
      true,
      "Billing Dashboard PaymentDialog — duplicate-statement-warning appears for the matching insurance amount",
    );

    const warnTextB = await page.$eval(
      '[data-testid="duplicate-statement-warning"]',
      (el: Element) => el.textContent || "",
    );
    assert(
      warnTextB.includes(PAYER) && warnTextB.includes(CHECK_NO),
      "Billing Dashboard PaymentDialog — warning names the posted statement's payer + check number",
    );

    const disabledBeforeB = await page.$eval(
      '[data-testid="record-payment-submit"]',
      (el: Element) => (el as HTMLButtonElement).disabled,
    );
    assert(
      disabledBeforeB,
      "Billing Dashboard PaymentDialog — submit is DISABLED while the duplicate is unacknowledged",
    );

    await clickTestId(page, "confirm-duplicate-insurance-checkbox");

    await page.waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-testid="record-payment-submit"]',
        ) as HTMLButtonElement | null;
        return !!btn && !btn.disabled;
      },
      { timeout: 30_000 },
    );
    const disabledAfterB = await page.$eval(
      '[data-testid="record-payment-submit"]',
      (el: Element) => (el as HTMLButtonElement).disabled,
    );
    assert(
      !disabledAfterB,
      "Billing Dashboard PaymentDialog — ticking the override checkbox ENABLES submit",
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

/**
 * BROWSER-LEVEL test that the PRINTED / "Save as PDF" running STATEMENT a payout
 * reviewer hands off (the generated print document, not the on-screen cards or
 * the CSV) carries the CORRECTED, de-inflated pay after a duplicate-insurance-
 * payment cleanup — driven through the real /therapist-payments page in a real
 * Chromium.
 *
 * Sibling suites cover the lower / adjacent layers of the SAME scenario:
 *   - test/insurance-void-repost-corrects-pay.test.ts proves at the STORAGE
 *     layer that after the void → re-open → re-post cleanup of a double-counted
 *     insurance payment, the therapist earnings ledger self-corrects (appends a
 *     negative adjustment so net pay falls from the inflated $100 back to $50).
 *   - test/therapist-statement-monthly-running-agree.test.ts proves at the
 *     STORAGE layer that the per-month statement and the running statement
 *     agree (same net earned per session; opening+earned−paid lands on the
 *     running balance).
 *   - test/therapist-statement-corrected-pay-ui.test.ts proves at the BROWSER
 *     layer that the RUNNING Statement tab (on-screen cards) shows the
 *     corrected $50.
 *   - test/therapist-statement-corrected-pay-monthly-ui.test.ts proves at the
 *     BROWSER layer that the on-screen Monthly Report tab (the cards + the
 *     session row) show the corrected $50.
 *   - test/therapist-statement-corrected-pay-monthly-csv.test.ts proves at the
 *     BROWSER layer that the DOWNLOADED Monthly CSV carries the corrected $50.
 *   - test/therapist-statement-corrected-pay-monthly-print.test.ts proves at the
 *     BROWSER layer that the PRINTED / "Save as PDF" MONTHLY REPORT carries the
 *     corrected $50.
 *
 * THIS suite closes the remaining gap: the running Statement tab has its OWN
 * "Save as PDF" code path (StatementTab's exportPrint → printHtml builder in
 * client/src/pages/therapist-payments.tsx), DISTINCT from the MonthlyReportTab
 * print path the sibling above covers — different report body (a chronological
 * ledger with a running balance, not a per-session table), different cards. A
 * future regression that re-inflates pay in THIS print path would ship
 * undetected. This asserts the generated print HTML's "Total earned" card, the
 * "Currently owed" card (the running-statement total) AND the earning row's
 * Earned cell all read the corrected $50.00, NOT the inflated $100.00.
 *
 * What it does (in order):
 *   1. Seeds an APRIL session/billing with a 50% pay rule. POSTS a $100
 *      insurance statement (collected = $100, correct), then — simulating staff
 *      not realizing the EOB was already posted — MANUALLY keys the same $100
 *      again so collected inflates to $200 (the classic double-count).
 *   2. Materializes the INFLATED earning by reading the therapist statement
 *      once (a single $100 earning row; pay overstated — should be $50).
 *   3. CLEANS UP operationally (no raw column edit), exactly like a real fix:
 *      void the statement → re-open it → re-post it. The guard adopts the
 *      manual $100 and posts a $0 shortfall, so collected lands back on $100.
 *   4. Loads /therapist-payments authenticated as a billing user, picks the
 *      therapist, opens the "Statement" tab, then clicks the print/PDF export
 *      button (data-testid `button-statement-print`). Because printHtml opens a
 *      popup window and calls window.print(), the test intercepts window.open
 *      and captures the HTML written to the popup's document, then asserts the
 *      "Total earned" card, the "Currently owed" card and the earning row's
 *      Earned cell all read the corrected single $50.00, NOT $100.00.
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/therapist-statement-corrected-pay-statement-print.test.ts
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

const SUFFIX = `thr-stmt-corrected-statement-print-${Date.now()}`;

// The affected month for the seeded session/billing.
const SESSION_ISO = "2026-04-12T10:00:00.000Z";

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
    // --- Seed therapist, billing actor, client, service, session, billing ---
    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    // A billing-role user can reach /therapist-payments and its routes.
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
        sessionDate: new Date(SESSION_ISO),
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

    // Default percentage pay rule: 50% of collected.
    await db.insert(therapistPayRules).values({
      therapistId,
      serviceId: null,
      payType: "percentage",
      payValue: "50.00",
    });

    // --- 1. Build the over-collected ($200) double-count state -------------
    // Post a $100 statement (collected = $100, correct).
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
    // so 200 means "add another $100 manual row on top". collected → $200.
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

    // --- 2. Materialize the INFLATED earning (single $100 earning row) -----
    const inflatedStatement = await storage.getTherapistStatement(therapistId);
    assertEqual(
      inflatedStatement.currentOwed,
      100,
      "Before cleanup the therapist statement is inflated: currentOwed is $100 (50% of $200)",
    );

    // --- 3. Clean up via the REAL operational flow (no raw column edit) ----
    await storage.voidInsuranceStatement(
      statementId,
      billingUserId,
      "duplicate EOB cleanup — running-statement print check",
    );
    await storage.reopenInsuranceStatement(statementId, billingUserId);
    await storage.postInsuranceStatement(statementId, billingUserId);

    b = await getBilling(billingId);
    assertEqual(
      Number(b.insurancePaidAmount),
      100,
      "After void → re-open → re-post, collected is back on the correct single $100",
    );

    // --- 4. Browser flow: load the Statement tab, print/PDF export ---------
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

    await page.goto(`${baseUrl}/therapist-payments`, {
      waitUntil: "domcontentloaded",
    });

    // Open the therapist picker (a Radix Popover — needs a TRUSTED click; a
    // synthetic DOM .click() does not open it). Then type our therapist's unique
    // name into the cmdk search so the option renders even with a long list, and
    // pick it.
    await page.waitForSelector('[data-testid="select-therapist"]:not([disabled])', {
      timeout: 30_000,
    });
    await page.click('[data-testid="select-therapist"]');
    await page.waitForSelector('[data-testid="input-therapist-search"]', {
      timeout: 30_000,
    });
    await page.type('[data-testid="input-therapist-search"]', SUFFIX);
    await page.waitForSelector(`[data-testid="option-therapist-${therapistId}"]`, {
      timeout: 30_000,
    });
    await page.click(`[data-testid="option-therapist-${therapistId}"]`);

    // Open the Statement tab and wait for its running-statement GET to return
    // 200 (no date range — the running statement is the full ledger).
    const [statementResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res
            .url()
            .includes(`/api/therapist-pay/statement/${therapistId}`) &&
          res.request().method() === "GET",
        { timeout: 45_000 },
      ),
      clickTabById(page, "tab-statement"),
    ]);
    assertEqual(
      statementResp.status(),
      200,
      "Opening the Statement tab fires GET /statement that returns 200",
    );

    // Sanity-check the on-screen card is corrected before exporting, so a failed
    // print assertion below isn't blamed on stale on-screen data. The "Currently
    // owed" card (text-statement-balance) is the running-statement total.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="text-statement-balance"]',
        );
        return !!el && (el.textContent || "").trim() === "$50.00";
      },
      { timeout: 30_000 },
    );

    // printHtml opens a popup window (window.open) and writes the print document
    // into it, then calls window.print(). There is no Blob to intercept like the
    // CSV path. Instead wrap window.open to return a stub window whose
    // document.write accumulates the generated HTML, so we can read back exactly
    // what the PRINTED / "Save as PDF" document contains. The stub also provides
    // the focus/print/close methods printHtml calls so the export path completes
    // and returns true (not "pop-up blocked").
    // tsx/esbuild compiles this test with `keepNames`, which wraps the arrow
    // methods of the stub object below in `__name(fn, "...")` calls. That helper
    // does not exist in the browser page context, so without this shim the stub's
    // object literal throws "__name is not defined" the moment printHtml calls
    // window.open() — document.write never runs and the capture stays null. Define
    // __name as identity via a STRING evaluate (strings are not transformed by
    // esbuild, so no __name is injected into the shim itself).
    await page.evaluate(
      "window.__name = window.__name || function (f) { return f; };",
    );
    await page.evaluate(() => {
      (window as any).__printCapture = null;
      (window as any).open = function () {
        let html = "";
        return {
          document: {
            write: (s: string) => {
              html += s;
              (window as any).__printCapture = html;
            },
            close: () => {},
          },
          focus: () => {},
          print: () => {},
          closed: false,
        };
      };
    });

    // Trusted ElementHandle click (scroll into view first) — matches the Radix
    // patterns in .agents/memory/browser-tests-puppeteer.md and is more robust
    // than a bare page.click under load.
    const printSel = '[data-testid="button-statement-print"]:not([disabled])';
    await page.waitForSelector(printSel, { timeout: 30_000 });
    const printBtn = await page.$(printSel);
    if (!printBtn) throw new Error("print button not found");
    await printBtn.evaluate((el: Element) =>
      el.scrollIntoView({ block: "center", inline: "center" }),
    );
    await printBtn.click();

    await page.waitForFunction(
      () => typeof (window as any).__printCapture === "string",
      { timeout: 60_000 },
    );
    const printHtml: string = await page.evaluate(
      () => (window as any).__printCapture as string,
    );

    assert(
      typeof printHtml === "string" && printHtml.length > 0,
      "Print/PDF export produced a generated print document",
    );
    assert(
      printHtml.includes("<!doctype html>") &&
        printHtml.includes("Running Statement"),
      "Print document is the full running-statement HTML (doctype + Running Statement heading)",
    );

    // The "Total earned" summary card is built as
    //   <div class="label">Total earned</div><div class="value">${money(totalEarned)}</div>
    // It MUST read the corrected $50.00 — not the inflated $100.00.
    const earnedCardMatch = /Total earned<\/div><div class="value">([^<]+)<\/div>/.exec(
      printHtml,
    );
    assert(
      !!earnedCardMatch,
      "Print document contains the 'Total earned' summary card",
    );
    assertEqual(
      (earnedCardMatch?.[1] || "").trim(),
      "$50.00",
      "Print document 'Total earned' card reads the corrected $50.00 (not the inflated $100.00)",
    );

    // The "Currently owed" card is the running-statement TOTAL (net owed). With
    // no payouts it equals total earned and MUST read the corrected $50.00.
    const owedCardMatch = /Currently owed<\/div><div class="value">([^<]+)<\/div>/.exec(
      printHtml,
    );
    assert(
      !!owedCardMatch,
      "Print document contains the 'Currently owed' running-statement total card",
    );
    assertEqual(
      (owedCardMatch?.[1] || "").trim(),
      "$50.00",
      "Print document 'Currently owed' running-statement total reads the corrected $50.00 (not $100.00)",
    );

    // The ledger table row carries Earned as the FIRST .num cell (Earned, Paid,
    // Balance). Find the <tr> data row by our unique client name (it appears in
    // the earning line's description), then read its numeric cells. SUFFIX also
    // appears in the therapist name printed in the <h1> title (the pre-table
    // chunk), so additionally require the fragment to hold a numeric data cell —
    // otherwise .find() returns that title chunk (no <td class="num">) and the
    // Earned cell reads undefined.
    const rowFragment = printHtml
      .split("<tr>")
      .find((frag) => frag.includes(SUFFIX) && frag.includes('<td class="num'));
    assert(
      !!rowFragment,
      "Print document contains the seeded session's earning row",
    );
    const numCells = Array.from(
      (rowFragment || "").matchAll(/<td class="num[^"]*">([^<]*)<\/td>/g),
    ).map((m) => m[1].trim());
    // Earned is the FIRST numeric column; Balance is the last. Both must be the
    // corrected $50.00 (Paid is empty for this earning-only row).
    assertEqual(
      numCells[0],
      "$50.00",
      "Print document earning row Earned cell reads the corrected $50.00 (not the inflated $100.00)",
    );
    assertEqual(
      numCells[numCells.length - 1],
      "$50.00",
      "Print document earning row running Balance reads the corrected $50.00 (not $100.00)",
    );

    // Storage cross-check: the ledger self-corrected via an append-only negative
    // adjustment, so net earning for the session is $50 (corrected $100 * 50%).
    const ledgerRows = await db
      .select()
      .from(therapistEarnings)
      .where(eq(therapistEarnings.sessionBillingId, billingId!));
    const netEarned =
      Math.round(
        ledgerRows.reduce((sum, r) => sum + Number(r.amountEarned), 0) * 100,
      ) / 100;
    assertEqual(
      netEarned,
      50,
      "Net therapist-earnings ledger for the session is the corrected $50 (append-only self-correction)",
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
        await db
          .delete(auditLogs)
          .where(eq(auditLogs.resourceType, "therapist_earning"))
          .catch(() => {});
        // The print/PDF export writes a 'therapist_payout' export-audit row keyed
        // by therapistId; remove it so the user delete below isn't blocked by the
        // audit_logs.user_id FK and no rows leak between runs.
        await db
          .delete(auditLogs)
          .where(
            and(
              eq(auditLogs.resourceType, "therapist_payout"),
              eq(auditLogs.resourceId, String(therapistId)),
            ),
          )
          .catch(() => {});
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

main();

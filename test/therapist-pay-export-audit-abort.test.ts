/**
 * BROWSER-LEVEL compliance test that a therapist-pay report export is ABORTED
 * when its audit-trail write fails — so PHI-bearing payout data can never leave
 * the app un-audited — driven through the real /therapist-payments page in a
 * real Chromium.
 *
 * WHY THIS MATTERS
 * Every therapist-pay report export (running Statement / Monthly Report, CSV or
 * PDF) is required to leave an audit trail BEFORE the data leaves the app. In
 * client/src/pages/therapist-payments.tsx both exportCsv and exportPrint first
 * `await auditExport(...)` (POST /api/therapist-pay/export-audit) and, if that
 * call throws, show an "Export blocked" toast and RETURN early — so no CSV blob
 * is built and no print window is opened. A regression that exported anyway (or
 * stopped awaiting the audit) would silently leak un-audited payout data with no
 * failing test. This suite locks that abort-on-audit-failure behaviour.
 *
 * Sibling suites prove the happy-path export CONTENT is correct (e.g.
 * test/therapist-statement-corrected-pay-statement-print.test.ts and
 * test/therapist-statement-corrected-pay-monthly-csv.test.ts). THIS suite proves
 * the COMPLIANCE gate: when the audit write fails, nothing is exported.
 *
 * What it does (in order):
 *   1. Seeds a therapist with one collected session/billing and a 50% pay rule,
 *      then reads the therapist statement once so a real earning entry exists
 *      (the export buttons are disabled when there are zero entries).
 *   2. Loads /therapist-payments authenticated as a billing user, picks the
 *      therapist, and opens the running "Statement" tab.
 *   3. Installs in-page interceptors:
 *        - window.fetch is wrapped to FORCE every POST to
 *          /api/therapist-pay/export-audit to resolve as HTTP 500 (so
 *          apiRequest throws and auditExport rejects). All other requests pass
 *          through untouched.
 *        - URL.createObjectURL is wrapped to flag if a CSV blob URL is ever
 *          minted (the only way the CSV download fires).
 *        - window.open is wrapped to flag if a print window is ever opened (the
 *          only way the PDF/print path fires).
 *   4. Clicks the CSV export button, then the Print/PDF export button. For each:
 *        - asserts the forced export-audit POST was actually attempted,
 *        - asserts NO CSV blob URL was created and NO print window was opened,
 *        - asserts the "Export blocked" toast appeared.
 *   5. Cross-checks at the DB layer that NO therapist_statement_exported audit
 *      row was written for this therapist (the server never recorded a leak,
 *      consistent with the client having aborted before any data left).
 *
 * Auth mirrors a logged-in browser session exactly via the shared loginAs helper
 * (genuine /api/auth/login → httpOnly sessionToken + readable csrfToken cookies +
 * localStorage.currentUser). The app is spawned as a real dev server on an
 * ephemeral port so the Vite frontend and Express API run together.
 *
 * Run with: npx tsx test/therapist-pay-export-audit-abort.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named rows and removes them (and
 *   anything derived) in a finally block.
 * - Must run serially with the other app-level tests (shared dev DB races on
 *   generated identifiers when run concurrently — see
 *   .agents/memory/privacy-test-concurrency.md). Chained into `test-privacy`.
 * - See .agents/memory/browser-tests-puppeteer.md for the auth + Radix patterns.
 * - tsx/esbuild compiles this test with `keepNames`, which wraps the arrow
 *   methods of in-page stub objects in `__name(fn, "...")` calls. That helper
 *   does not exist in the page context, so before installing any window.fetch /
 *   window.open / URL.createObjectURL override we define `window.__name` as
 *   identity via a STRING evaluate (strings are not transformed by esbuild).
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

const SUFFIX = `thr-pay-export-audit-abort-${Date.now()}`;

// The seeded session's month (any past month with a collected session works).
const SESSION_ISO = "2026-04-12T10:00:00.000Z";

// Radix Tabs only mount the ACTIVE tab's content and require a TRUSTED event to
// switch — a synthetic DOM .click() will not change the tab. Drive a real
// ElementHandle click. See .agents/memory/browser-tests-puppeteer.md.
async function clickTabById(page: Page, testId: string) {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  const handle = await page.$(selector);
  if (!handle) throw new Error(`tab ${testId} not found`);
  await handle.evaluate((el: Element) =>
    el.scrollIntoView({ block: "center", inline: "center" }),
  );
  await handle.click();
}

// ---------------------------------------------------------------------------
async function main() {
  let therapistId: number | undefined;
  let billingUserId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  let billingId: number | undefined;

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

    // A collected billing (insurance paid $100) so the therapist has earnings.
    const [billing] = await db
      .insert(sessionBilling)
      .values({
        sessionId,
        serviceCode: service.serviceCode,
        units: 1,
        ratePerUnit: "100.00",
        totalAmount: "100.00",
        clientPaidAmount: "0.00",
        insurancePaidAmount: "100.00",
        billingDate: "2026-04-12",
        paymentStatus: "paid",
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

    // Read the statement once so the earning entry is materialized — the export
    // buttons are disabled when the statement has zero entries.
    const statement = await storage.getTherapistStatement(therapistId);
    assert(
      statement.entries.length > 0,
      "Seeded therapist statement has at least one entry (export buttons will be enabled)",
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

    await page.goto(`${baseUrl}/therapist-payments`, {
      waitUntil: "domcontentloaded",
    });

    // Open the therapist picker (a Radix Popover — needs a TRUSTED click). Type
    // our therapist's unique name into the cmdk search so the option renders even
    // with a long list, and pick it.
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

    // Open the Statement tab and wait for its running-statement GET to return 200.
    const [statementResp] = await Promise.all([
      page.waitForResponse(
        (res: any) =>
          res.url().includes(`/api/therapist-pay/statement/${therapistId}`) &&
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

    // Wait for the export buttons to be present and enabled (entries loaded).
    await page.waitForSelector(
      '[data-testid="button-statement-csv"]:not([disabled])',
      { timeout: 30_000 },
    );
    await page.waitForSelector(
      '[data-testid="button-statement-print"]:not([disabled])',
      { timeout: 30_000 },
    );

    // --- Install in-page interceptors -------------------------------------
    // Define __name as identity FIRST via a STRING evaluate (strings are not
    // transformed by esbuild, so no __name is injected into the shim itself).
    await page.evaluate(
      "window.__name = window.__name || function (f) { return f; };",
    );

    await page.evaluate(() => {
      const w = window as any;

      // Counters / flags the assertions read back.
      w.__exportAuditCalls = 0; // POSTs to /export-audit that we forced to fail
      w.__csvBlobUrls = 0; // CSV blob URLs minted (download fired) — must stay 0
      w.__printWindows = 0; // print windows opened — must stay 0

      // 1) Force every export-audit POST to fail with HTTP 500 so auditExport
      //    (via apiRequest → throwIfResNotOk) throws. Everything else passes
      //    straight through to the real fetch.
      const origFetch = window.fetch.bind(window);
      window.fetch = function (input: any, init?: any) {
        const url =
          typeof input === "string"
            ? input
            : input && typeof input.url === "string"
              ? input.url
              : "";
        const method = (
          (init && init.method) ||
          (input && input.method) ||
          "GET"
        ).toUpperCase();
        if (url.includes("/api/therapist-pay/export-audit") && method === "POST") {
          w.__exportAuditCalls++;
          return Promise.resolve(
            new Response(JSON.stringify({ message: "forced audit failure" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return origFetch(input, init);
      };

      // 2) Flag if a CSV blob URL is ever minted (downloadFile → createObjectURL).
      const origCreate = URL.createObjectURL.bind(URL);
      (URL as any).createObjectURL = function (obj: any) {
        w.__csvBlobUrls++;
        return origCreate(obj);
      };

      // 3) Flag if a print window is ever opened (printHtml → window.open).
      window.open = function () {
        w.__printWindows++;
        return null as any;
      };
    });

    const getCounters = () =>
      page.evaluate(() => {
        const w = window as any;
        return {
          auditCalls: w.__exportAuditCalls as number,
          csvBlobUrls: w.__csvBlobUrls as number,
          printWindows: w.__printWindows as number,
        };
      });

    // Wait for an "Export blocked" toast to appear in the DOM, then return true.
    const waitForExportBlockedToast = async () => {
      try {
        await page.waitForFunction(
          () => document.body.innerText.includes("Export blocked"),
          { timeout: 15_000 },
        );
        return true;
      } catch {
        return false;
      }
    };

    // Dismiss any visible toast between the two sub-tests so the second wait
    // can't be satisfied by the first toast lingering. Radix toasts auto-expire,
    // but we also clear them explicitly to keep the assertions independent: walk
    // up from any node whose text holds the toast title and remove the toast
    // root (the <li>/element rendered into the Radix viewport).
    const clearToasts = async () => {
      await page.evaluate(() => {
        Array.from(document.querySelectorAll("*"))
          .filter(
            (el) =>
              (el.textContent || "").includes("Export blocked") &&
              el.children.length === 0,
          )
          .forEach((leaf) => {
            let node: Element | null = leaf;
            // Climb to the toast list item / viewport child, then drop it.
            while (
              node &&
              node.parentElement &&
              node.parentElement.tagName !== "OL" &&
              node.parentElement !== document.body
            ) {
              node = node.parentElement;
            }
            node?.remove();
          });
      });
      // Confirm the title text is actually gone before proceeding.
      await page
        .waitForFunction(
          () => !document.body.innerText.includes("Export blocked"),
          { timeout: 10_000 },
        )
        .catch(() => {});
    };

    // =====================================================================
    // CSV path: audit fails → no CSV blob, "Export blocked" toast
    // =====================================================================
    console.log("\nTest: CSV export is aborted when the audit write fails");
    const csvBtn = await page.$(
      '[data-testid="button-statement-csv"]:not([disabled])',
    );
    if (!csvBtn) throw new Error("CSV export button not found");
    await csvBtn.evaluate((el: Element) =>
      el.scrollIntoView({ block: "center", inline: "center" }),
    );
    await csvBtn.click();

    const csvToast = await waitForExportBlockedToast();
    assert(csvToast, "CSV export shows the 'Export blocked' toast");

    const afterCsv = await getCounters();
    assert(
      afterCsv.auditCalls >= 1,
      "CSV export attempted the export-audit POST (which we forced to fail)",
    );
    assertEqual(
      afterCsv.csvBlobUrls,
      0,
      "No CSV blob URL was minted — the download never fired (PHI not exported)",
    );
    assertEqual(
      afterCsv.printWindows,
      0,
      "No print window was opened during the CSV path",
    );

    await clearToasts();

    // =====================================================================
    // PDF/print path: audit fails → no print window, "Export blocked" toast
    // =====================================================================
    console.log("\nTest: Print/PDF export is aborted when the audit write fails");
    const printBtn = await page.$(
      '[data-testid="button-statement-print"]:not([disabled])',
    );
    if (!printBtn) throw new Error("Print export button not found");
    await printBtn.evaluate((el: Element) =>
      el.scrollIntoView({ block: "center", inline: "center" }),
    );
    await printBtn.click();

    const printToast = await waitForExportBlockedToast();
    assert(printToast, "Print/PDF export shows the 'Export blocked' toast");

    const afterPrint = await getCounters();
    assert(
      afterPrint.auditCalls >= 2,
      "Print/PDF export attempted its own export-audit POST (forced to fail)",
    );
    assertEqual(
      afterPrint.printWindows,
      0,
      "No print window was opened — the PDF/print path never ran (PHI not exported)",
    );
    assertEqual(
      afterPrint.csvBlobUrls,
      0,
      "No CSV blob URL was minted across either export attempt",
    );

    // =====================================================================
    // DB cross-check: the server recorded NO successful export-audit row.
    // The client aborted before any data left, and the forced-failed POSTs
    // never reached a successful insert path.
    // =====================================================================
    console.log("\nTest: No therapist_statement_exported audit row was written");
    const exportRows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "therapist_statement_exported"),
          eq(auditLogs.resourceId, String(therapistId)),
        ),
      );
    assertEqual(
      exportRows.length,
      0,
      "No therapist_statement_exported audit row exists for this therapist (nothing was exported)",
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
      if (therapistId != null) {
        await db
          .delete(therapistPayRules)
          .where(eq(therapistPayRules.therapistId, therapistId));
        // Remove any export-audit rows keyed by therapistId so the user delete
        // below isn't blocked by the audit_logs.user_id FK and no rows leak.
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
        await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds));
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

/**
 * BROWSER-LEVEL test for the insurance reconciliation screen's per-line edit
 * guard on a POSTED line — driven through a real Chromium against a real dev
 * server.
 *
 * Background
 * ----------
 * The per-line `canEdit` gate in the reconciliation detail view is:
 *
 *     canEdit = line.matchStatus !== "posted" && statement.status !== "voided"
 *
 * The VOIDED half of that gate has browser coverage already
 * (test/insurance-reconciliation-voided-ui.test.ts). The OTHER half — a single
 * POSTED line on a statement that is NOT voided (it is "posted") — had none. A
 * posted line is terminal: the server refuses to re-edit it, and the UI must
 * collapse its Actions cell to the read-only "$amount" fallback instead of the
 * confirm/unconfirm/skip/clear/link controls + billing-# input. A UI regression
 * could re-expose those per-line edit buttons on an already-posted line, leaving
 * staff clicking actions the server always rejects.
 *
 * This suite closes that gap by exercising the genuine UI on a single POSTED
 * statement that contains BOTH:
 *   - a POSTED line (confirmed → posted) whose Actions cell must show NO
 *     per-line edit control (confirm/unconfirm/skip/clear/link/input) — only the
 *     read-only posted-amount fallback; and
 *   - a still-editable line (unmatched, never posted) on the SAME statement whose
 *     edit controls (skip / link / billing-# input) ARE still present — proving
 *     the gate keys off the LINE's matchStatus, not the whole statement, so it is
 *     not merely always-off.
 *
 * The reconciliation page keeps the open statement in component state (no URL
 * for the detail view), so the statement is opened by navigating fresh to
 * /insurance-reconciliation and clicking its `button-open-statement-<id>`.
 *
 * Auth mirrors a real logged-in browser session (see test/helpers/browser.ts);
 * the route is restricted to admin/billing, so we log in as a billing user.
 *
 * Run with: npx tsx test/insurance-reconciliation-posted-line-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a dedicated, uniquely-named billing user + therapist +
 *   client + service + session + billing, plus one POSTED statement that has a
 *   posted line AND an unmatched (still-editable) line, and removes them (and
 *   every row they generate) at the end. Must run serially with the other
 *   app-level tests (shared dev DB races on generated identifiers — see
 *   .agents/memory/privacy-test-concurrency.md). It is chained into the
 *   `test-privacy` validation.
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
  sessionBilling,
  paymentTransactions,
  insuranceStatements,
  insuranceStatementLines,
  auditLogs,
} from "../shared/schema";
import { eq, inArray, asc } from "drizzle-orm";

let testsPassed = 0;
let testsFailed = 0;

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

const SUFFIX = `ins-recon-posted-ui-${Date.now()}`;
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdBillingIds: number[] = [];
const createdStatementIds: number[] = [];

// --- Seed helpers ----------------------------------------------------------

async function getLines(statementId: number) {
  return db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.statementId, statementId))
    .orderBy(asc(insuranceStatementLines.id));
}

// Seed a billing record (therapist → client → service → session → billing).
async function seedBilling(label: string) {
  const therapist = await storage.createUser({
    username: `therapist-${label}-${SUFFIX}`,
    password: "x",
    fullName: `Therapist ${label} ${SUFFIX}`,
    email: `therapist-${label}-${SUFFIX}@example.test`,
    role: "therapist",
  } as any);
  createdUserIds.push(therapist.id);

  const client = await storage.createClient({
    fullName: `Patient ${label} ${SUFFIX}`,
    assignedTherapistId: therapist.id,
  } as any);
  createdClientIds.push(client.id);

  const service = await storage.createService({
    serviceCode: `SVC-${label}-${SUFFIX}`,
    serviceName: `Test Service ${label} ${SUFFIX}`,
    duration: 60,
    baseRate: "200.00",
  } as any);
  createdServiceIds.push(service.id);

  const session = await storage.createSession({
    clientId: client.id,
    therapistId: therapist.id,
    serviceId: service.id,
    sessionDate: new Date(),
    sessionType: "individual",
    status: "completed",
  } as any);

  const billing = await storage.createSessionBilling(session.id);
  if (!billing) throw new Error("Failed to create billing for test session");
  createdBillingIds.push(billing.id);

  return { billing, service, client };
}

// Seed a POSTED statement with TWO lines:
//   1. a line that gets confirmed → posted (matched to `billing`); and
//   2. a line with a deliberately unmatchable name (no candidate billing) so it
//      stays "unmatched" and therefore still editable after the statement posts.
// Posting the statement turns the first line "posted" and the statement
// "posted", while the second line stays editable (matchStatus !== "posted",
// status !== "voided").
async function seedPostedStatementWithEditableLine(
  billingId: number,
  postedServiceCode: string,
  postedClientName: string,
  userId: number,
) {
  const stmt = await storage.createInsuranceStatement(
    {
      fileName: `stmt-posted-${SUFFIX}.pdf`,
      sourceType: "pdf",
      payerName: `Test Payer ${SUFFIX}`,
      statementDate: new Date().toISOString().slice(0, 10),
      status: "draft",
    } as any,
    [
      // Line 1 — will be confirmed + posted.
      {
        clientNameRaw: postedClientName,
        serviceCode: postedServiceCode,
        insurancePaidAmount: "100.00",
      } as any,
      // Line 2 — deliberately unmatchable so it stays unmatched/editable.
      {
        clientNameRaw: `Zzzqx Nomatch ${SUFFIX}`,
        serviceCode: `NOPE-${SUFFIX}`,
        insurancePaidAmount: "50.00",
      } as any,
    ],
  );
  createdStatementIds.push(stmt.id);

  const lines = await getLines(stmt.id);
  const postedLine = lines[0];
  const editableLine = lines[1];

  // Force the first line to a clean confirmed + matched state, then post.
  await storage.updateStatementLineMatch(postedLine.id, {
    matchStatus: "confirmed",
    matchedSessionBillingId: billingId,
  });
  await storage.postInsuranceStatement(stmt.id, userId);

  return { statementId: stmt.id, postedLineId: postedLine.id, editableLineId: editableLine.id };
}

// --- Page helpers ----------------------------------------------------------

async function domClick(page: Page, selector: string): Promise<void> {
  const clicked = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`Could not find element to click: ${selector}`);
}

async function exists(page: Page, selector: string): Promise<boolean> {
  return (await page.$(selector)) !== null;
}

// Read a control's disabled state. Returns null when the element is absent.
async function isDisabled(page: Page, selector: string): Promise<boolean | null> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLButtonElement | null;
    if (!el) return null;
    return el.disabled === true || el.hasAttribute("disabled");
  }, selector);
}

// Navigate fresh to the reconciliation list and open a statement's detail view,
// waiting until a given claim line has rendered (so the detail data is loaded).
async function openStatementDetail(
  page: Page,
  baseUrl: string,
  statementId: number,
  lineId: number,
): Promise<void> {
  await page.goto(`${baseUrl}/insurance-reconciliation`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector(
    `[data-testid="button-open-statement-${statementId}"]`,
    { timeout: 30_000 },
  );
  await domClick(page, `[data-testid="button-open-statement-${statementId}"]`);
  await page.waitForSelector('[data-testid="view-statement-detail"]', {
    timeout: 15_000,
  });
  await page.waitForSelector(`[data-testid="row-line-${lineId}"]`, {
    timeout: 15_000,
  });
}

// --- Main ------------------------------------------------------------------

async function main() {
  let server: DevServer | null = null;
  let browser: Browser | null = null;

  try {
    server = await startDevServer();
    browser = await launchBrowser();
    const { baseUrl } = server;

    // Billing user that both authenticates the UI and posts the seed.
    const billingUser = await storage.createUser({
      username: `billing-${SUFFIX}`,
      password: "x",
      fullName: `Billing ${SUFFIX}`,
      email: `billing-${SUFFIX}@example.test`,
      role: "billing",
    } as any);
    createdUserIds.push(billingUser.id);

    const { billing, service, client } = await seedBilling("posted");

    const seeded = await seedPostedStatementWithEditableLine(
      billing.id,
      service.serviceCode,
      client.fullName,
      billingUser.id,
    );

    // Preconditions: confirm the seed is in the expected states.
    const [postedStmt] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, seeded.statementId))
      .limit(1);
    assertEqual(postedStmt.status, "posted", "precondition — statement is 'posted' (not voided)");

    const lines = await getLines(seeded.statementId);
    const postedLine = lines.find((l) => l.id === seeded.postedLineId);
    const editableLine = lines.find((l) => l.id === seeded.editableLineId);
    assertEqual(postedLine?.matchStatus, "posted", "precondition — first line is 'posted'");
    assertEqual(
      editableLine?.matchStatus !== "posted",
      true,
      "precondition — second line is NOT posted (still editable)",
    );

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await loginAs(page, {
      username: billingUser.username,
      password: "x",
    });
    assertEqual(loginStatus, 200, "Billing user logs in via /api/auth/login");

    // Open the posted statement's detail view, waiting on the editable line so
    // we know the full line list rendered.
    await openStatementDetail(page, baseUrl, seeded.statementId, seeded.editableLineId);

    // -------------------------------------------------------------------
    // Test 1: the POSTED line shows NO per-line edit control — only the
    // read-only posted-amount fallback (canEdit === false for this line).
    // -------------------------------------------------------------------
    assertEqual(
      await exists(page, `[data-testid="button-confirm-${seeded.postedLineId}"]`),
      false,
      "1: per-line Confirm is absent on a posted line",
    );
    assertEqual(
      await exists(page, `[data-testid="button-unconfirm-${seeded.postedLineId}"]`),
      false,
      "1: per-line Unconfirm is absent on a posted line",
    );
    assertEqual(
      await exists(page, `[data-testid="button-skip-${seeded.postedLineId}"]`),
      false,
      "1: per-line Skip is absent on a posted line",
    );
    assertEqual(
      await exists(page, `[data-testid="button-clear-${seeded.postedLineId}"]`),
      false,
      "1: per-line Clear-match is absent on a posted line",
    );
    assertEqual(
      await exists(page, `[data-testid="button-link-${seeded.postedLineId}"]`),
      false,
      "1: per-line Link is absent on a posted line",
    );
    assertEqual(
      await exists(page, `[data-testid="input-billing-${seeded.postedLineId}"]`),
      false,
      "1: per-line billing-# input is absent on a posted line",
    );

    // -------------------------------------------------------------------
    // Test 2: the still-editable line on the SAME (posted) statement keeps
    // its edit controls — proving the gate keys off the LINE's matchStatus,
    // not the whole statement (i.e. not merely always-off).
    // -------------------------------------------------------------------
    assertEqual(
      await isDisabled(page, `[data-testid="button-skip-${seeded.editableLineId}"]`),
      false,
      "2: per-line Skip is present and enabled on the still-editable line",
    );
    assertEqual(
      await exists(page, `[data-testid="input-billing-${seeded.editableLineId}"]`),
      true,
      "2: per-line billing-# input is present on the still-editable line",
    );
    assertEqual(
      await exists(page, `[data-testid="button-link-${seeded.editableLineId}"]`),
      true,
      "2: per-line Link is present on the still-editable line",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
    // --- Cleanup -----------------------------------------------------------
    try {
      if (createdClientIds.length > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.clientId, createdClientIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.userId, createdUserIds));
      }
      if (createdBillingIds.length > 0) {
        await db
          .delete(paymentTransactions)
          .where(inArray(paymentTransactions.sessionBillingId, createdBillingIds));
      }
      if (createdStatementIds.length > 0) {
        // Cascades insurance_statement_lines.
        await db
          .delete(insuranceStatements)
          .where(inArray(insuranceStatements.id, createdStatementIds));
      }
      if (createdBillingIds.length > 0) {
        await db
          .delete(sessionBilling)
          .where(inArray(sessionBilling.id, createdBillingIds));
      }
      if (createdClientIds.length > 0) {
        // Cascades sessions.
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdServiceIds.length > 0) {
        await db.delete(services).where(inArray(services.id, createdServiceIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupErr) {
      console.error("⚠️  Cleanup error:", cleanupErr);
    }
  }

  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  if (testsFailed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});

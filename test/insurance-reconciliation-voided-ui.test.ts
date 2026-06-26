/**
 * BROWSER-LEVEL test for the insurance reconciliation screen's edit guard on a
 * VOIDED statement — driven through a real Chromium against a real dev server.
 *
 * Background
 * ----------
 * Voiding an insurance statement is terminal. The server already refuses any
 * edit to a voided statement (PATCH a line / rematch / post all return 400 —
 * see test/insurance-voided-statement-locked.test.ts). But the FRONT-END guard
 * — the reconciliation detail view hiding the rematch / post / per-line edit
 * controls once a statement is voided (the `canEdit` gate plus the `!isVoided`
 * conditions) — had no automated coverage. A UI regression could re-expose
 * those buttons even though the server rejects the call, leaving staff clicking
 * actions that always fail.
 *
 * This suite closes that gap by exercising the genuine UI:
 *   1. Open a VOIDED statement from the real reconciliation list and assert the
 *      screen-level edit controls (Re-run matching, Post payments, Void) are
 *      ABSENT, and that every per-line edit control (confirm/unconfirm/skip/
 *      clear/link + the billing-# input) is ABSENT — the `canEdit` gate is off.
 *   2. Open a DRAFT statement and assert those same controls ARE present and
 *      ENABLED — proving the gate is conditional on the voided status, not
 *      always-off.
 *
 * The reconciliation page keeps the open statement in component state (no URL
 * for the detail view), so each statement is opened by navigating fresh to
 * /insurance-reconciliation and clicking its `button-open-statement-<id>`.
 *
 * Auth mirrors a real logged-in browser session (see test/helpers/browser.ts);
 * the route is restricted to admin/billing, so we log in as a billing user.
 *
 * Run with: npx tsx test/insurance-reconciliation-voided-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a dedicated, uniquely-named billing user + therapist +
 *   client + service + session + billing, plus one DRAFT and one VOIDED
 *   insurance statement, and removes them (and every row they generate) at the
 *   end. Must run serially with the other app-level tests (shared dev DB races
 *   on generated identifiers — see .agents/memory/privacy-test-concurrency.md).
 *   It is chained into the `test-privacy` validation.
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
import { eq, inArray } from "drizzle-orm";

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

const SUFFIX = `ins-recon-ui-${Date.now()}`;
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdBillingIds: number[] = [];
const createdStatementIds: number[] = [];

// --- Seed helpers ----------------------------------------------------------

async function getLine(statementId: number) {
  const [line] = await db
    .select()
    .from(insuranceStatementLines)
    .where(eq(insuranceStatementLines.statementId, statementId))
    .limit(1);
  return line;
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

  return { billing, service };
}

async function createStatementWithLine(
  billingId: number,
  label: string,
  serviceCode: string,
) {
  const stmt = await storage.createInsuranceStatement(
    {
      fileName: `stmt-${label}-${SUFFIX}.pdf`,
      sourceType: "pdf",
      payerName: `Test Payer ${SUFFIX}`,
      statementDate: new Date().toISOString().slice(0, 10),
      status: "draft",
    } as any,
    [
      {
        clientNameRaw: `Patient ${label} ${SUFFIX}`,
        serviceCode,
        insurancePaidAmount: "100.00",
      } as any,
    ],
  );
  createdStatementIds.push(stmt.id);
  const line = await getLine(stmt.id);
  return { statementId: stmt.id, lineId: line.id };
}

// A DRAFT statement with one CONFIRMED line (so the "Post payment(s)" button is
// enabled — it is disabled when confirmedCount === 0).
async function seedDraftStatement(billingId: number, serviceCode: string) {
  const { statementId, lineId } = await createStatementWithLine(
    billingId,
    "draft",
    serviceCode,
  );
  await storage.updateStatementLineMatch(lineId, {
    matchStatus: "confirmed",
    matchedSessionBillingId: billingId,
  });
  return { statementId, lineId };
}

// A VOIDED statement: confirm → post → void leaves it terminal.
async function seedVoidedStatement(
  billingId: number,
  serviceCode: string,
  userId: number,
) {
  const { statementId, lineId } = await createStatementWithLine(
    billingId,
    "voided",
    serviceCode,
  );
  await storage.updateStatementLineMatch(lineId, {
    matchStatus: "confirmed",
    matchedSessionBillingId: billingId,
  });
  await storage.postInsuranceStatement(statementId, userId);
  await storage.voidInsuranceStatement(statementId, userId, "test void — UI lock check");
  return { statementId, lineId };
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
// waiting until its claim line has rendered (so the detail data is loaded).
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

    // Billing user that both authenticates the UI and posts/voids the seed.
    const billingUser = await storage.createUser({
      username: `billing-${SUFFIX}`,
      password: "x",
      fullName: `Billing ${SUFFIX}`,
      email: `billing-${SUFFIX}@example.test`,
      role: "billing",
    } as any);
    createdUserIds.push(billingUser.id);

    const { billing: draftBilling, service: draftService } = await seedBilling("draft");
    const { billing: voidBilling, service: voidService } = await seedBilling("void");

    const draft = await seedDraftStatement(draftBilling.id, draftService.serviceCode);
    const voided = await seedVoidedStatement(
      voidBilling.id,
      voidService.serviceCode,
      billingUser.id,
    );

    // Preconditions: confirm the seed is in the expected states.
    const [draftStmt] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, draft.statementId))
      .limit(1);
    assertEqual(draftStmt.status, "draft", "precondition — draft statement is 'draft'");
    const [voidStmt] = await db
      .select()
      .from(insuranceStatements)
      .where(eq(insuranceStatements.id, voided.statementId))
      .limit(1);
    assertEqual(voidStmt.status, "voided", "precondition — voided statement is 'voided'");

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await loginAs(page, {
      username: billingUser.username,
      password: "x",
    });
    assertEqual(loginStatus, 200, "Billing user logs in via /api/auth/login");

    // -------------------------------------------------------------------
    // Test 1: VOIDED statement hides every edit control (canEdit gate off).
    // -------------------------------------------------------------------
    await openStatementDetail(page, baseUrl, voided.statementId, voided.lineId);

    assertEqual(
      await exists(page, '[data-testid="button-rematch"]'),
      false,
      "1: 'Re-run matching' is absent on a voided statement",
    );
    assertEqual(
      await exists(page, '[data-testid="button-post-statement"]'),
      false,
      "1: 'Post payment(s)' is absent on a voided statement",
    );
    assertEqual(
      await exists(page, '[data-testid="button-void-statement"]'),
      false,
      "1: 'Void' is absent on an already-voided statement",
    );

    // Per-line edit controls are all gated off (canEdit === false).
    assertEqual(
      await exists(page, `[data-testid="button-confirm-${voided.lineId}"]`),
      false,
      "1: per-line Confirm is absent on a voided statement's line",
    );
    assertEqual(
      await exists(page, `[data-testid="button-unconfirm-${voided.lineId}"]`),
      false,
      "1: per-line Unconfirm is absent on a voided statement's line",
    );
    assertEqual(
      await exists(page, `[data-testid="button-skip-${voided.lineId}"]`),
      false,
      "1: per-line Skip is absent on a voided statement's line",
    );
    assertEqual(
      await exists(page, `[data-testid="button-clear-${voided.lineId}"]`),
      false,
      "1: per-line Clear-match is absent on a voided statement's line",
    );
    assertEqual(
      await exists(page, `[data-testid="button-link-${voided.lineId}"]`),
      false,
      "1: per-line Link is absent on a voided statement's line",
    );
    assertEqual(
      await exists(page, `[data-testid="input-billing-${voided.lineId}"]`),
      false,
      "1: per-line billing-# input is absent on a voided statement's line",
    );

    // -------------------------------------------------------------------
    // Test 2: DRAFT statement shows those same controls, ENABLED — proving
    // the gate is conditional on the voided status, not always-off.
    // -------------------------------------------------------------------
    await openStatementDetail(page, baseUrl, draft.statementId, draft.lineId);

    assertEqual(
      await isDisabled(page, '[data-testid="button-rematch"]'),
      false,
      "2: 'Re-run matching' is present and enabled on a draft statement",
    );
    assertEqual(
      await isDisabled(page, '[data-testid="button-post-statement"]'),
      false,
      "2: 'Post payment(s)' is present and enabled on a draft (confirmed line)",
    );
    // The seeded draft line is 'confirmed', so its edit controls render & enable.
    assertEqual(
      await isDisabled(page, `[data-testid="button-unconfirm-${draft.lineId}"]`),
      false,
      "2: per-line Unconfirm is present and enabled on a draft line",
    );
    assertEqual(
      await isDisabled(page, `[data-testid="button-skip-${draft.lineId}"]`),
      false,
      "2: per-line Skip is present and enabled on a draft line",
    );
    assertEqual(
      await exists(page, `[data-testid="input-billing-${draft.lineId}"]`),
      true,
      "2: per-line billing-# input is present on a draft line",
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

/**
 * BROWSER-LEVEL test for the REAL record drawers — driven through a real
 * Chromium against a real dev server.
 *
 * The companion suite (test/record-drawer-back-button-ui.test.ts) drives a
 * DEV-only harness page (client/src/pages/drawer-test-harness.tsx) that calls
 * the RecordDrawerContext API directly with a data-free drawer type. That proves
 * the history/Back mechanics in the context, but it never opens an ACTUAL record
 * drawer. A regression in how a real page wires up openDrawer /
 * replaceTopDrawer (e.g. the clients list opening a client, or the assessment
 * report's "Edit Assessment Responses" lateral switch) would pass the harness
 * tests yet break in production.
 *
 * This suite closes that gap by exercising the genuine UI wiring:
 *   1. Open a client from the REAL clients list (clients.tsx -> openDrawer
 *      "client-detail", depth 1).
 *   2. Drill into a nested record — the assessment report opened from inside the
 *      client-detail drawer's Assessments tab (depth 2).
 *   3. Browser Back closes the nested drawer ONE level at a time (2 -> 1 -> 0),
 *      revealing the client-detail drawer before closing it.
 *   4. The assessment -> report/completion lateral switch (replaceTopDrawer via
 *      the report page's "Edit Assessment Responses" button) keeps the depth and
 *      the history length unchanged AND leaves Back able to close.
 *
 * Depth is read from the rendered host (no harness readout exists here):
 *   - depth 0: no [data-testid="record-drawer"] element.
 *   - depth 1: the drawer is present with NO breadcrumb (host renders the
 *     breadcrumb only when stack.length > 1).
 *   - depth 2: the drawer is present AND [data-testid="breadcrumb-drawer-0"]
 *     exists. The top title comes from [data-testid="record-drawer-title"].
 *
 * Auth mirrors a real logged-in browser session (see test/helpers/browser.ts).
 *
 * Run with: npx tsx test/record-drawer-real-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a dedicated, uniquely-named therapist + client + assessment
 *   template + assignment and removes them (and any audit rows they generate) at
 *   the end. Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md).
 */

import type { Browser, Page } from "puppeteer";
import {
  startDevServer,
  launchBrowser,
  loginAs,
  clickTab,
  type DevServer,
} from "./helpers/browser";
import { db } from "../server/db";
import { users, clients, assessmentTemplates } from "../shared/schema";
import { storage } from "../server/storage";
import { inArray } from "drizzle-orm";

const DRAWER_SELECTOR = '[data-testid="record-drawer"]';
const TITLE_SELECTOR = '[data-testid="record-drawer-title"]';
const BREADCRUMB_SELECTOR = '[data-testid="breadcrumb-drawer-0"]';

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

const SUFFIX = `drawer-real-ui-${Date.now()}`;
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdTemplateIds: number[] = [];

// --- Seed helpers ----------------------------------------------------------

async function makeTherapist(label: string) {
  const user = await storage.createUser({
    username: `${label}-${SUFFIX}`,
    password: "x",
    fullName: `${label} ${SUFFIX}`,
    email: `${label}-${SUFFIX}@example.test`,
    role: "therapist",
  } as any);
  createdUserIds.push(user.id);
  return user;
}

async function makeClient(assignedTherapistId: number, label: string) {
  const client = await storage.createClient({
    fullName: `${label} ${SUFFIX}`,
    assignedTherapistId,
  } as any);
  createdClientIds.push(client.id);
  return client;
}

async function makeTemplate(createdById: number) {
  const template = await storage.createAssessmentTemplate({
    name: `Drawer UI Assessment ${SUFFIX}`,
    createdById,
  } as any);
  createdTemplateIds.push(template.id);
  return template;
}

async function makeAssignment(
  templateId: number,
  clientId: number,
  assignedById: number,
) {
  // "waiting_for_therapist" => the client-detail assessment card shows the
  // "Draft" primary button (button-draft-<id>), which opens the assessment
  // REPORT drawer — the nested record this test drills into.
  return storage.createAssessmentAssignment({
    templateId,
    clientId,
    assignedById,
    status: "waiting_for_therapist",
  } as any);
}

// --- Page helpers ----------------------------------------------------------

// Click a plain <button>/element by selector via an in-page DOM click. The
// drawer slides in with an animation during which puppeteer's ElementHandle
// .click() can fail its clickablePoint check, so a direct DOM click is both
// reliable and faithful for ordinary onClick handlers (Radix Tabs are the
// exception — those need a trusted event, see clickTab in browser.ts).
async function domClick(page: Page, selector: string): Promise<void> {
  const clicked = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`Could not find element to click: ${selector}`);
}

async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => window.history.back());
}

async function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => window.history.length);
}

// Read the current drawer depth from the rendered host (0, 1 or 2).
async function readDepth(page: Page): Promise<number> {
  return page.evaluate(
    (drawerSel: string, breadcrumbSel: string) => {
      const drawer = document.querySelector(drawerSel);
      if (!drawer) return 0;
      const breadcrumb = document.querySelector(breadcrumbSel);
      return breadcrumb ? 2 : 1;
    },
    DRAWER_SELECTOR,
    BREADCRUMB_SELECTOR,
  );
}

async function waitForDepth(page: Page, expected: number): Promise<void> {
  await page.waitForFunction(
    (drawerSel: string, breadcrumbSel: string, n: number) => {
      const drawer = document.querySelector(drawerSel);
      const depth = !drawer ? 0 : document.querySelector(breadcrumbSel) ? 2 : 1;
      return depth === n;
    },
    { timeout: 15_000 },
    DRAWER_SELECTOR,
    BREADCRUMB_SELECTOR,
    expected,
  );
}

async function readTitle(page: Page): Promise<string> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return el ? el.textContent || "" : "";
  }, TITLE_SELECTOR);
}

async function waitForTitle(page: Page, title: string): Promise<void> {
  await page.waitForFunction(
    (sel: string, expected: string) => {
      const el = document.querySelector(sel);
      return !!el && el.textContent === expected;
    },
    { timeout: 15_000 },
    TITLE_SELECTOR,
    title,
  );
}

// Open the client-detail drawer from the real clients list (depth 0 -> 1).
async function openClientDrawer(
  page: Page,
  clientId: number,
  clientName: string,
): Promise<void> {
  await page.waitForSelector(`[data-testid="button-view-${clientId}"]`, {
    timeout: 30_000,
  });
  await domClick(page, `[data-testid="button-view-${clientId}"]`);
  await page.waitForSelector(DRAWER_SELECTOR, { timeout: 15_000 });
  await waitForTitle(page, clientName);
  await waitForDepth(page, 1);
}

// From an open client-detail drawer, switch to the Assessments tab and open the
// assessment report drawer (depth 1 -> 2).
async function openAssessmentReportDrawer(
  page: Page,
  assignmentId: number,
): Promise<void> {
  // The tab list is a Radix Tabs trigger — it needs a TRUSTED ElementHandle
  // click (a synthetic in-page click does not switch a Radix tab).
  await clickTab(page, /Assessments/);
  await page.waitForSelector(`[data-testid="button-draft-${assignmentId}"]`, {
    timeout: 15_000,
  });
  await domClick(page, `[data-testid="button-draft-${assignmentId}"]`);
  await waitForTitle(page, "Assessment Report");
  await waitForDepth(page, 2);
}

// --- Main ------------------------------------------------------------------

async function main() {
  let server: DevServer | null = null;
  let browser: Browser | null = null;

  try {
    server = await startDevServer();
    browser = await launchBrowser();
    const { baseUrl } = server;

    const therapist = await makeTherapist("ui-therapist");
    const client = await makeClient(therapist.id, "ui-client");
    const template = await makeTemplate(therapist.id);
    const assignment = await makeAssignment(template.id, client.id, therapist.id);

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await loginAs(page, {
      username: therapist.username,
      password: "x",
    });
    assertEqual(loginStatus, 200, "Therapist logs in via /api/auth/login");

    // -------------------------------------------------------------------
    // Test 1: open a REAL client drawer from the REAL clients list.
    // -------------------------------------------------------------------
    await page.goto(`${baseUrl}/clients`, { waitUntil: "domcontentloaded" });
    await openClientDrawer(page, client.id, client.fullName);
    assertEqual(
      await readDepth(page),
      1,
      "Opening a client from the clients list shows the client drawer (depth 1)",
    );
    assertEqual(
      await readTitle(page),
      client.fullName,
      "The client drawer title is the client's name",
    );

    // -------------------------------------------------------------------
    // Test 2: drill into the nested assessment report (depth 1 -> 2).
    // -------------------------------------------------------------------
    await openAssessmentReportDrawer(page, assignment.id);
    assertEqual(
      await readDepth(page),
      2,
      "Opening the assessment report stacks a second drawer level (depth 2)",
    );
    assertEqual(
      await readTitle(page),
      "Assessment Report",
      "The nested drawer shows the Assessment Report",
    );

    // -------------------------------------------------------------------
    // Test 3: browser Back closes the nested drawer ONE level at a time.
    // -------------------------------------------------------------------
    await pressBack(page);
    await waitForDepth(page, 1);
    assertEqual(
      await readDepth(page),
      1,
      "First Back closes only the nested record, revealing the client drawer (2 -> 1)",
    );
    assertEqual(
      await readTitle(page),
      client.fullName,
      "After one Back the client drawer is shown again",
    );
    await pressBack(page);
    await waitForDepth(page, 0);
    assertEqual(
      await readDepth(page),
      0,
      "Second Back closes the client drawer (1 -> 0)",
    );
    assertEqual(
      await page.$(DRAWER_SELECTOR),
      null,
      "No drawer element remains after both levels close",
    );

    // -------------------------------------------------------------------
    // Test 4: the assessment -> completion lateral switch in the real UI.
    // The report page's "Edit Assessment Responses" button calls
    // replaceTopDrawer, which must keep depth + history length unchanged.
    // -------------------------------------------------------------------
    await openClientDrawer(page, client.id, client.fullName);
    await openAssessmentReportDrawer(page, assignment.id);
    const beforeLen = await historyLength(page);
    await page.waitForSelector('[data-testid="button-edit-assessment-responses"]', {
      timeout: 15_000,
    });
    await domClick(page, '[data-testid="button-edit-assessment-responses"]');
    await waitForTitle(page, "Complete Assessment");
    assertEqual(
      await readDepth(page),
      2,
      "Lateral switch to the completion form keeps depth at 2",
    );
    assertEqual(
      await readTitle(page),
      "Complete Assessment",
      "Lateral switch swaps the nested drawer to the completion form",
    );
    assertEqual(
      await historyLength(page),
      beforeLen,
      "Lateral switch does not change history length",
    );

    // Back still closes one level at a time after the lateral switch.
    await pressBack(page);
    await waitForDepth(page, 1);
    assertEqual(
      await readDepth(page),
      1,
      "Back after a lateral switch closes the nested drawer (2 -> 1)",
    );
    assertEqual(
      await readTitle(page),
      client.fullName,
      "The client drawer is revealed after closing the swapped nested drawer",
    );
    await pressBack(page);
    await waitForDepth(page, 0);
    assertEqual(
      await readDepth(page),
      0,
      "A final Back closes the client drawer (1 -> 0)",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
    try {
      // Deleting clients cascades assignments -> responses/reports. Audit rows
      // reference clientId (ON DELETE SET NULL) and userId, so clear ours first.
      const { auditLogs } = await import("../shared/schema");
      if (createdClientIds.length > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.clientId, createdClientIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(auditLogs).where(inArray(auditLogs.userId, createdUserIds));
      }
      if (createdClientIds.length > 0) {
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
      }
      if (createdTemplateIds.length > 0) {
        await db
          .delete(assessmentTemplates)
          .where(inArray(assessmentTemplates.id, createdTemplateIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
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

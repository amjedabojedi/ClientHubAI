/**
 * BROWSER-LEVEL test for the migrated SESSION editing slide-over drawers.
 *
 * Task #107 moved the two staff session-editing pop-ups on the client-detail
 * page out of Radix <Dialog>s and into the RecordDrawer slide-over system:
 *   - "session-details"   — "Session Details & Actions" (opens from the session
 *                            card "Edit Session Details" menu item)
 *   - "full-edit-session" — "Edit Session"              (stacks ON TOP of
 *                            session-details via the in-drawer "Edit This
 *                            Session" button, at size "wide")
 *
 * Their bodies are no longer rendered by their own Dialog — they are PORTALED
 * (createPortal) into the single host outlet and open/close through the drawer
 * stack (openInlineDrawer / closeTopDrawer / closeToIndex). Drawer stacking,
 * breadcrumb navigation, and browser-Back behaviour could not be verified
 * interactively in this environment (login wall + static screenshots). A
 * wrong inlineKey, a portal guard that never matches, a breadcrumb that pops the
 * wrong level, or a Back press that navigates away from the client page would
 * silently break a core staff workflow and is invisible to typecheck/unit tests.
 * Only a real-browser test can lock in the navigation contract.
 *
 * What it does (logged in as an admin, against a real dev server in Chromium):
 *   1. Sessions tab → open the session card "⋮" menu → "Edit Session Details"
 *      → asserts the "Session Details & Actions" drawer opens (depth 1, no
 *      breadcrumb).
 *   2. The in-drawer "Edit This Session" button stacks the "Edit Session" drawer
 *      → asserts depth 2: title is "Edit Session" AND the breadcrumb shows BOTH
 *      levels (a clickable "Session Details & Actions" crumb + the current
 *      "Edit Session").
 *   3. Clicking the breadcrumb pops back to "Session Details & Actions" (depth 1).
 *   4. Re-stack "Edit Session", then press the browser Back button: it closes
 *      ONE drawer level per press (Edit Session → Session Details & Actions →
 *      closed) WITHOUT navigating away from the /clients/:id page.
 *
 * Auth + server wiring mirror the sibling browser suites exactly (see
 * test/helpers/browser.ts and .agents/memory/browser-tests-puppeteer.md):
 * a real dev server on an ephemeral port, in-page /api/auth/login, and
 * localStorage.currentUser seeded for the SPA's useAuth.
 *
 * Run with: npx tsx test/session-edit-drawers-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a dedicated admin, client, service, and a session whose
 *   note is NOT finalized (so the "Edit Session Details" menu item is shown);
 *   all removed at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md).
 */

import type { Browser, Page } from "puppeteer";
import {
  startDevServer,
  launchBrowser,
  loginAs,
  type DevServer,
} from "./helpers/browser";
import { db } from "../server/db";
import { users, clients, services, sessions } from "../shared/schema";
import { storage } from "../server/storage";
import { inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------
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

const SUFFIX = `session-edit-ui-${Date.now()}`;
const DRAWER = '[data-testid="record-drawer"]';
const TITLE = '[data-testid="record-drawer-title"]';
const BREADCRUMB_0 = '[data-testid="breadcrumb-drawer-0"]';

const SESSION_DETAILS_TITLE = "Session Details & Actions";
const EDIT_SESSION_TITLE = "Edit Session";

// Track seeded rows for teardown.
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdSessionIds: number[] = [];

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function seed() {
  const admin = await storage.createUser({
    username: `admin-${SUFFIX}`,
    password: "x",
    fullName: `Admin ${SUFFIX}`,
    email: `admin-${SUFFIX}@example.test`,
    role: "admin",
  } as any);
  createdUserIds.push(admin.id);

  const client = await storage.createClient({
    fullName: `Session Edit Client ${SUFFIX}`,
    assignedTherapistId: admin.id,
  } as any);
  createdClientIds.push(client.id);

  const service = await storage.createService({
    serviceCode: `SVC-${SUFFIX}`.slice(0, 50),
    serviceName: `Individual Therapy ${SUFFIX}`,
    duration: 60,
    baseRate: "120.00",
  } as any);
  createdServiceIds.push(service.id);

  // A session with NO finalized note → the card menu shows the "Session
  // Actions" section including the "Edit Session Details" item that opens the
  // session-details drawer.
  const session = await storage.createSession({
    clientId: client.id,
    therapistId: admin.id,
    serviceId: service.id,
    sessionDate: new Date(),
    sessionType: "individual",
    status: "scheduled",
  } as any);
  createdSessionIds.push(session.id);

  return { admin, client, session };
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

// Trusted click on an element by data-testid. Radix DropdownMenu/Tabs need a
// REAL event (a synthetic in-page .click() does not toggle them), so we use an
// ElementHandle click here for the menu trigger + menu item.
async function trustedClick(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: 30_000 });
  const handle = await page.$(selector);
  if (!handle) throw new Error(`Could not find element to click: ${selector}`);
  await handle.click();
}

// Plain DOM click for ordinary onClick buttons (e.g. the in-drawer "Edit This
// Session" button, the breadcrumb back-button). The drawer slides in with a
// ~500ms animation during which puppeteer's clickablePoint check can fail, so
// an in-page DOM click is both reliable and faithful for these handlers.
async function domClick(page: Page, selector: string): Promise<void> {
  const clicked = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`Could not find element to click: ${selector}`);
}

// Wait until the drawer is open AND its title equals `expected`. The drawer
// element stays mounted across stack pushes/pops, so we must wait on the TITLE
// text, not merely on the drawer's presence.
async function waitForDrawerTitle(page: Page, expected: string): Promise<void> {
  await page.waitForSelector(DRAWER, { timeout: 30_000 });
  await page.waitForFunction(
    (sel: string, want: string) => {
      const el = document.querySelector(sel);
      return !!el && (el.textContent || "").trim() === want;
    },
    { timeout: 30_000 },
    TITLE,
    expected,
  );
}

async function getDrawerTitle(page: Page): Promise<string | null> {
  const el = await page.$(TITLE);
  if (!el) return null;
  return el.evaluate((n: Element) => (n.textContent || "").trim());
}

async function drawerIsOpen(page: Page): Promise<boolean> {
  return (await page.$(DRAWER)) !== null;
}

async function waitForDrawerClosed(page: Page): Promise<void> {
  await page.waitForFunction(
    (sel: string) => !document.querySelector(sel),
    { timeout: 30_000 },
    DRAWER,
  );
}

// Press the browser Back button. Drawer open/close uses same-URL pushState
// entries, so a real popstate must be fired via history.back() — page.goBack()
// does not fire for same-URL entries.
async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => window.history.back());
}

function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

// ---------------------------------------------------------------------------
async function main() {
  let devServer: DevServer | null = null;
  let browser: Browser | null = null;

  try {
    devServer = await startDevServer();
    const baseUrl = devServer.baseUrl;
    browser = await launchBrowser();

    const { admin, client, session } = await seed();

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await loginAs(page, { username: admin.username, password: "x" });
    assertEqual(loginStatus, 200, "Admin logs in via /api/auth/login");

    const clientPath = `/clients/${client.id}`;
    await page.goto(`${baseUrl}${clientPath}?tab=sessions`, {
      waitUntil: "domcontentloaded",
    });

    // -------------------------------------------------------------------
    // Step 1: open the session card menu → "Edit Session Details".
    // -------------------------------------------------------------------
    await trustedClick(page, `[data-testid="session-menu-trigger-${session.id}"]`);
    await trustedClick(page, `[data-testid="menu-edit-session-details-${session.id}"]`);
    await waitForDrawerTitle(page, SESSION_DETAILS_TITLE);
    assertEqual(
      await getDrawerTitle(page),
      SESSION_DETAILS_TITLE,
      '"Edit Session Details" opens the session-details drawer',
    );
    assertEqual(
      (await page.$(BREADCRUMB_0)) !== null,
      false,
      "At depth 1 the session-details drawer shows no breadcrumb",
    );

    // -------------------------------------------------------------------
    // Step 2: "Edit This Session" stacks the "Edit Session" drawer (depth 2),
    // and the breadcrumb shows BOTH levels.
    // -------------------------------------------------------------------
    await domClick(page, '[data-testid="button-edit-session-inline"]');
    await waitForDrawerTitle(page, EDIT_SESSION_TITLE);
    assertEqual(
      await getDrawerTitle(page),
      EDIT_SESSION_TITLE,
      '"Edit This Session" stacks the full-edit-session drawer (depth 2)',
    );
    await page.waitForSelector(BREADCRUMB_0, { timeout: 30_000 });
    assertEqual(
      (await page.$(BREADCRUMB_0)) !== null,
      true,
      "At depth 2 a breadcrumb back to the session-details drawer is shown",
    );
    assertEqual(
      await page.$eval(BREADCRUMB_0, (el: Element) => (el.textContent || "").trim()),
      SESSION_DETAILS_TITLE,
      "The breadcrumb's first crumb is the parent Session Details & Actions level",
    );

    // -------------------------------------------------------------------
    // Step 3: clicking the breadcrumb pops back to "Session Details & Actions".
    // -------------------------------------------------------------------
    await domClick(page, BREADCRUMB_0);
    await waitForDrawerTitle(page, SESSION_DETAILS_TITLE);
    assertEqual(
      await getDrawerTitle(page),
      SESSION_DETAILS_TITLE,
      "Clicking the breadcrumb pops back to the session-details drawer",
    );
    assertEqual(
      (await page.$(BREADCRUMB_0)) !== null,
      false,
      "Back at depth 1 the breadcrumb is gone again",
    );

    // -------------------------------------------------------------------
    // Step 4: re-stack, then the browser Back button closes ONE level per
    // press without navigating away from the client page.
    // -------------------------------------------------------------------
    await domClick(page, '[data-testid="button-edit-session-inline"]');
    await waitForDrawerTitle(page, EDIT_SESSION_TITLE);
    assertEqual(
      await getDrawerTitle(page),
      EDIT_SESSION_TITLE,
      "Re-opening the Edit Session drawer stacks to depth 2 again",
    );

    // First Back: pops only the Edit Session level.
    await pressBack(page);
    await waitForDrawerTitle(page, SESSION_DETAILS_TITLE);
    assertEqual(
      await getDrawerTitle(page),
      SESSION_DETAILS_TITLE,
      "Browser Back closes only the Edit Session level, revealing session-details",
    );
    assertEqual(
      pathOf(page),
      clientPath,
      "After the first Back the page is still the client-detail page",
    );

    // Second Back: closes the remaining session-details level.
    await pressBack(page);
    await waitForDrawerClosed(page);
    assertEqual(
      await drawerIsOpen(page),
      false,
      "A second browser Back closes the last drawer level",
    );
    assertEqual(
      pathOf(page),
      clientPath,
      "After closing all drawers the page never navigated away from the client",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (devServer) await devServer.stop();
    // Cleanup in FK-safe order: sessions, services, clients, users.
    try {
      if (createdSessionIds.length > 0) {
        await db.delete(sessions).where(inArray(sessions.id, createdSessionIds));
      }
      if (createdServiceIds.length > 0) {
        await db.delete(services).where(inArray(services.id, createdServiceIds));
      }
      if (createdClientIds.length > 0) {
        await db.delete(clients).where(inArray(clients.id, createdClientIds));
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

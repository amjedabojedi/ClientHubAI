/**
 * BROWSER-LEVEL test for the record-drawer Back-button integration — driven
 * through a real Chromium against a real dev server.
 *
 * The drawer system pushes one same-URL history entry per open level so the
 * browser Back button closes the TOP drawer instead of leaving the client page
 * (see client/src/contexts/RecordDrawerContext.tsx). That behaviour was only
 * ever verified manually after the in-session harness was disabled. A wiring
 * regression — Back navigating away while a drawer is open, a multi-level close
 * collapsing too many levels at once, or the assessment completion<->report
 * lateral switch stacking history instead of replacing it — would be invisible
 * to a unit test. Only a real browser driving real popstate events can prove it.
 *
 * What it covers (each group starts from a fresh harness load = depth 0):
 *   1. Open one level, press browser Back -> closes that one level.
 *   2. Open two levels, press Back twice -> closes ONE level per press.
 *   3. The drawer "X" close button closes one level.
 *   4. The Escape key closes one level.
 *   5. A breadcrumb click collapses to that level.
 *   6. "Close all" collapses every level back to depth 0.
 *   7. The assessment-style lateral switch (replaceTopDrawer at depth 1) keeps
 *      depth and history length unchanged AND leaves Back still able to close.
 *   8. Pressing Back with NO drawer open performs normal page navigation.
 *   9. Regression: replaceTopDrawer is a no-op at depth 0 and does not change
 *      history.length at depth 1.
 *
 * The harness page (/__drawer-test-harness, DEV-only) drives the
 * RecordDrawerContext API directly with a data-free drawer type, so the test
 * exercises the history mechanics without seeding any client records.
 *
 * Auth mirrors a real logged-in browser session (see test/helpers/browser.ts):
 * logging in through /api/auth/login sets the httpOnly sessionToken + readable
 * csrfToken cookies and seeds localStorage.currentUser (which useAuth reads).
 *
 * Run with: npx tsx test/record-drawer-back-button-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a dedicated, uniquely-named therapist and removes it at the
 *   end. Must run serially with the other app-level tests (see
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
import { users } from "../shared/schema";
import { storage } from "../server/storage";
import { inArray } from "drizzle-orm";

const HARNESS_PATH = "/__drawer-test-harness";
const DRAWER_SELECTOR = '[data-testid="record-drawer"]';

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

const SUFFIX = `drawer-back-ui-${Date.now()}`;
const createdUserIds: number[] = [];

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

// --- Page helpers ----------------------------------------------------------

async function readDepth(page: Page): Promise<number> {
  const text = await page.$eval(
    '[data-testid="drawer-depth"]',
    (el: Element) => el.textContent || "",
  );
  return parseInt(text, 10);
}

async function waitForDepth(page: Page, expected: number): Promise<void> {
  await page.waitForFunction(
    (n: number) => {
      const el = document.querySelector('[data-testid="drawer-depth"]');
      return el && parseInt(el.textContent || "", 10) === n;
    },
    { timeout: 15_000 },
    expected,
  );
}

async function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => window.history.length);
}

async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => window.history.back());
}

// Click a plain <button> by data-testid via an in-page DOM click. The drawer
// slides in with a 500ms animation, during which puppeteer's ElementHandle
// .click() can fail its clickablePoint check ("not clickable") because the
// transformed element's centre is momentarily off-screen. All controls here are
// ordinary buttons with onClick handlers (no Radix trusted-event requirement),
// so a direct DOM click is both reliable and faithful to a real user click.
async function domClick(page: Page, selector: string): Promise<void> {
  const clicked = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`Could not find element to click: ${selector}`);
}

// Load the harness page fresh (full navigation). Used once at the start and
// again after the test that navigates away. A reload resets drawer state and the
// context strips any stale history marker on mount.
async function gotoHarness(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}${HARNESS_PATH}`, { waitUntil: "domcontentloaded" });
  await waitForDepth(page, 0);
}

// Bring the (already-loaded) harness back to depth 0 WITHOUT a full reload, so
// each test group starts clean cheaply. Closes one level per Back press, which
// is itself the behaviour under test, so it is a faithful reset.
async function resetHarness(page: Page): Promise<void> {
  let depth = await readDepth(page);
  let guard = 0;
  while (depth > 0 && guard < 10) {
    await pressBack(page);
    await waitForDepth(page, depth - 1);
    depth = await readDepth(page);
    guard += 1;
  }
}

// Open one more level. From depth 0 the trigger is on the underlying page; from
// depth >= 1 it must be the in-drawer control (the overlay covers the page).
async function openLevel(page: Page, fromDepth: number): Promise<void> {
  if (fromDepth === 0) {
    await domClick(page, '[data-testid="harness-open"]');
  } else {
    await domClick(page, '[data-testid="drawer-open-more"]');
  }
  await waitForDepth(page, fromDepth + 1);
}

// Click the Radix "X" close button inside the open drawer (its only accessible
// label is an sr-only "Close").
async function clickXClose(page: Page): Promise<void> {
  // The Radix "X" close is a plain button (sr-only label "Close"); a direct DOM
  // click dispatches a normal click event Radix handles to close — no trusted
  // event needed (unlike Radix Tabs). Driving it via ElementHandle.click can
  // fail clickablePoint on the tiny icon button, so click it in-page instead.
  const clicked = await page.evaluate((sel: string) => {
    const drawer = document.querySelector(sel);
    if (!drawer) return false;
    const buttons = Array.from(drawer.querySelectorAll("button"));
    const x = buttons.find((b) => /close/i.test(b.textContent || ""));
    if (!x) return false;
    (x as HTMLButtonElement).click();
    return true;
  }, DRAWER_SELECTOR);
  if (!clicked) throw new Error("Could not find the drawer X close button");
}

// --- Main ------------------------------------------------------------------

async function main() {
  let server: DevServer | null = null;
  let browser: Browser | null = null;

  try {
    server = await startDevServer();
    browser = await launchBrowser();
    const { baseUrl } = server;

    const t = await makeTherapist("ui-therapist");

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await loginAs(page, { username: t.username, password: "x" });
    assertEqual(loginStatus, 200, "Therapist logs in via /api/auth/login");

    // -------------------------------------------------------------------
    // Test 1: open one level, press Back -> closes it.
    // -------------------------------------------------------------------
    await gotoHarness(page, baseUrl);
    await openLevel(page, 0);
    await page.waitForSelector(DRAWER_SELECTOR, { timeout: 15_000 });
    assertEqual(await readDepth(page), 1, "Opening one level shows depth 1");
    await pressBack(page);
    await waitForDepth(page, 0);
    assertEqual(await readDepth(page), 0, "Browser Back closes the single open drawer");
    assertEqual(
      await page.$(DRAWER_SELECTOR),
      null,
      "Drawer element is gone after Back",
    );

    // -------------------------------------------------------------------
    // Test 2: open two levels, Back closes ONE level per press.
    // -------------------------------------------------------------------
    await resetHarness(page);
    await openLevel(page, 0);
    await openLevel(page, 1);
    assertEqual(await readDepth(page), 2, "Opening two levels shows depth 2");
    await pressBack(page);
    await waitForDepth(page, 1);
    assertEqual(await readDepth(page), 1, "First Back closes only the top level (2 -> 1)");
    await pressBack(page);
    await waitForDepth(page, 0);
    assertEqual(await readDepth(page), 0, "Second Back closes the remaining level (1 -> 0)");

    // -------------------------------------------------------------------
    // Test 3: the drawer X button closes one level.
    // -------------------------------------------------------------------
    await resetHarness(page);
    await openLevel(page, 0);
    await clickXClose(page);
    await waitForDepth(page, 0);
    assertEqual(await readDepth(page), 0, "Clicking the X closes the drawer");

    // -------------------------------------------------------------------
    // Test 4: the Escape key closes one level.
    // -------------------------------------------------------------------
    await resetHarness(page);
    await openLevel(page, 0);
    await page.keyboard.press("Escape");
    await waitForDepth(page, 0);
    assertEqual(await readDepth(page), 0, "Pressing Escape closes the drawer");

    // -------------------------------------------------------------------
    // Test 5: a breadcrumb click collapses to that level.
    // -------------------------------------------------------------------
    await resetHarness(page);
    await openLevel(page, 0);
    await openLevel(page, 1);
    await page.waitForSelector('[data-testid="breadcrumb-drawer-0"]', { timeout: 15_000 });
    await domClick(page, '[data-testid="breadcrumb-drawer-0"]');
    await waitForDepth(page, 1);
    assertEqual(
      await readDepth(page),
      1,
      "Clicking the first breadcrumb collapses back to depth 1",
    );

    // -------------------------------------------------------------------
    // Test 6: "Close all" collapses every level to depth 0.
    // -------------------------------------------------------------------
    await resetHarness(page);
    await openLevel(page, 0);
    await openLevel(page, 1);
    await domClick(page, '[data-testid="drawer-close-all"]');
    await waitForDepth(page, 0);
    assertEqual(await readDepth(page), 0, '"Close all" collapses both levels to depth 0');

    // -------------------------------------------------------------------
    // Test 7: the lateral switch (replaceTopDrawer at depth 1) keeps depth and
    // history length unchanged AND leaves Back able to close.
    // -------------------------------------------------------------------
    await resetHarness(page);
    await openLevel(page, 0);
    const beforeLenSwitch = await historyLength(page);
    await domClick(page, '[data-testid="drawer-replace-top"]');
    // Wait for the swapped title to render in the host header.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="drawer-top-title"]');
        return el && el.textContent === "Swapped";
      },
      { timeout: 15_000 },
    );
    assertEqual(await readDepth(page), 1, "Lateral switch keeps depth at 1");
    assertEqual(
      await historyLength(page),
      beforeLenSwitch,
      "Lateral switch does not change history length",
    );
    await pressBack(page);
    await waitForDepth(page, 0);
    assertEqual(
      await readDepth(page),
      0,
      "Back still closes the drawer after a lateral switch",
    );

    // -------------------------------------------------------------------
    // Test 8: Back with NO drawer open performs normal navigation.
    // -------------------------------------------------------------------
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.goto(`${baseUrl}${HARNESS_PATH}`, { waitUntil: "domcontentloaded" });
    await waitForDepth(page, 0);
    await Promise.all([
      page.waitForNavigation({ timeout: 15_000 }),
      page.evaluate(() => window.history.back()),
    ]);
    const afterBackPath = new URL(page.url()).pathname;
    assertEqual(
      afterBackPath !== HARNESS_PATH,
      true,
      "Back with no drawer open navigates away from the harness page",
    );

    // -------------------------------------------------------------------
    // Test 9: regression — replaceTopDrawer is a no-op at depth 0 and does not
    // change history.length at depth 1.
    // -------------------------------------------------------------------
    await gotoHarness(page, baseUrl);
    const lenAtZero = await historyLength(page);
    await domClick(page, '[data-testid="harness-replace-noop"]');
    // Give any (erroneous) state update a chance to flush before asserting.
    await new Promise((r) => setTimeout(r, 300));
    assertEqual(await readDepth(page), 0, "replaceTopDrawer at depth 0 does not open a drawer");
    assertEqual(
      await page.$(DRAWER_SELECTOR),
      null,
      "No drawer element exists after replaceTopDrawer at depth 0",
    );
    assertEqual(
      await historyLength(page),
      lenAtZero,
      "replaceTopDrawer at depth 0 does not change history length",
    );

    await openLevel(page, 0);
    const lenAtOne = await historyLength(page);
    await domClick(page, '[data-testid="drawer-replace-top"]');
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="drawer-top-title"]');
        return el && el.textContent === "Swapped";
      },
      { timeout: 15_000 },
    );
    assertEqual(await readDepth(page), 1, "replaceTopDrawer at depth 1 keeps depth at 1");
    assertEqual(
      await historyLength(page),
      lenAtOne,
      "replaceTopDrawer at depth 1 does not change history length",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
    try {
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

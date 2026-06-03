/**
 * BROWSER-LEVEL test for the Daily Schedule Email OPT-OUT toggle — driven
 * through the REAL settings screen a therapist clicks, in a real Chromium.
 *
 * Sibling suites cover lower layers:
 *   - test/daily-schedule-email-preference.test.ts writes the preference row
 *     directly and proves the daily-send loop honors it.
 *   - test/daily-schedule-email-preference-api.test.ts drives the preference
 *     through the notification-preferences HTTP API (requireAuth + CSRF + Zod).
 *
 * THIS suite closes the topmost gap: the actual frontend wiring. A bug in the
 * settings page (wrong endpoint, a missing CSRF header, an optimistic-update
 * mismatch, or a Switch that visually flips but never fires the request) could
 * show the therapist as opted out while the server never receives the change.
 * Only a browser test that loads the page, clicks the toggle, RELOADS, and
 * re-reads the toggle from a fresh server fetch can prove the change was
 * actually persisted server-side rather than living in local React state.
 *
 * What it does (same therapist, in order, mirroring real usage):
 *   1. Loads /notifications authenticated as a therapist, opens the
 *      "Preferences" tab, and asserts the daily-schedule-email Switch defaults
 *      to ON (no preference row => digest enabled).
 *   2. Clicks the Switch OFF, waits for the PUT to succeed, RELOADS the page,
 *      re-opens the tab, and asserts the Switch is still OFF — proving the
 *      opt-out round-tripped to the server. Confirms the persisted DB row too.
 *   3. Clicks the Switch back ON, waits for the PUT, RELOADS, re-opens the tab,
 *      and asserts the Switch is ON again. Confirms the DB row too.
 *
 * Auth mirrors a logged-in browser session exactly: a genuine session token
 * minted by createSessionToken (what /api/auth/login issues) is set as the
 * httpOnly sessionToken cookie, a matching csrfToken cookie is set so the
 * frontend's double-submit CSRF header validates, and localStorage.currentUser
 * is seeded (the frontend's useAuth reads the user from there).
 *
 * The app is spawned as a real dev server (server/index.ts via tsx) on an
 * ephemeral port so the Vite-served frontend and the Express API run together,
 * exactly like production wiring — not an in-process stub.
 *
 * Run with: npx tsx test/notification-preferences-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a dedicated, uniquely-named therapist and removes it (and
 *   its notification_preferences rows) at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md).
 * - Uses the system Chromium (PUPPETEER_EXECUTABLE_PATH or `which chromium`,
 *   falling back to puppeteer's bundled binary) with --no-sandbox.
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import { createServer } from "net";
import puppeteer, { type Browser } from "puppeteer";
import { db } from "../server/db";
import { users, notificationPreferences } from "../shared/schema";
import { storage } from "../server/storage";
import { eq, and, inArray } from "drizzle-orm";

// Must match DAILY_SCHEDULE_EMAIL_TRIGGER in server/notification-service.ts.
const DAILY_SCHEDULE_EMAIL_TRIGGER = "daily_schedule_email";
const SWITCH_SELECTOR = '[data-testid="switch-daily-schedule-email"]';

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

const SUFFIX = `dsepref-ui-${Date.now()}`;
const createdUserIds: number[] = [];

// ---------------------------------------------------------------------------
// Pick a free ephemeral port for our own dev-server instance.
// ---------------------------------------------------------------------------
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const port = (srv.address() as any).port as number;
      srv.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------------
// Resolve a Chromium binary that works in this environment.
// ---------------------------------------------------------------------------
function resolveChromium(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  try {
    const which = execSync("which chromium || which chromium-browser", {
      encoding: "utf8",
    }).trim();
    if (which) return which;
  } catch {
    // fall through to puppeteer's bundled binary
  }
  try {
    return puppeteer.executablePath();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Spawn the real dev server and wait until it answers /health.
// ---------------------------------------------------------------------------
let serverProc: ChildProcess | null = null;

async function startDevServer(port: number): Promise<string> {
  const baseUrl = `http://127.0.0.1:${port}`;
  serverProc = spawn("npx", ["tsx", "server/index.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      // Stub email provider config so cron startup is harmless; no email is sent.
      SPARKPOST_API_KEY: process.env.SPARKPOST_API_KEY || "test-sparkpost-key",
      EMAIL_FROM: process.env.EMAIL_FROM || "schedule@example.test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProc.stdout?.on("data", () => {});
  serverProc.stderr?.on("data", (d) => {
    const s = d.toString();
    if (/error/i.test(s)) console.error(`[devserver] ${s.trim()}`);
  });

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (serverProc.exitCode !== null) {
      throw new Error(`Dev server exited early with code ${serverProc.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok || res.status === 503) return baseUrl;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Dev server did not become ready within 120s");
}

async function stopDevServer() {
  if (!serverProc || serverProc.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const proc = serverProc!;
    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      resolve();
    }, 10_000);
    proc.on("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    try {
      proc.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Seed helper
// ---------------------------------------------------------------------------
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

async function getPersistedEmailEnabled(userId: number): Promise<boolean | null> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.triggerType, DAILY_SCHEDULE_EMAIL_TRIGGER),
      ),
    );
  return row ? row.enableEmail : null;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------
let browser: Browser;

// Open /notifications, switch to the Preferences tab, and wait for the
// daily-schedule-email Switch to render. Returns its aria-checked state.
async function openPreferencesAndReadSwitch(page: any): Promise<string | null> {
  // The Radix Tabs only mount the active tab's content, so we must click the
  // "Preferences" tab before the Switch exists in the DOM. Use a real
  // ElementHandle click (a trusted mouse event) — a synthetic .click() inside
  // page.evaluate does not drive the Radix Tabs state change.
  await page.waitForSelector('[role="tab"]', { timeout: 30_000 });
  const tabHandles = await page.$$('[role="tab"]');
  let clicked = false;
  for (const handle of tabHandles) {
    const text = await handle.evaluate((el: Element) => el.textContent || "");
    if (/preferences/i.test(text)) {
      await handle.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error('Could not find the "Preferences" tab to click');
  await page.waitForSelector(SWITCH_SELECTOR, { timeout: 30_000 });
  return page.$eval(SWITCH_SELECTOR, (el: Element) =>
    el.getAttribute("aria-checked"),
  );
}

// Click the Switch and wait for the PUT to succeed (status 200).
async function toggleSwitchAndAwaitPut(page: any) {
  const putUrl = `/api/notifications/preferences/${DAILY_SCHEDULE_EMAIL_TRIGGER}`;
  const [response] = await Promise.all([
    page.waitForResponse(
      (res: any) =>
        res.url().includes(putUrl) &&
        res.request().method() === "PUT",
      { timeout: 30_000 },
    ),
    page.click(SWITCH_SELECTOR),
  ]);
  return response.status();
}

// ---------------------------------------------------------------------------
async function main() {
  const port = await findFreePort();
  const baseUrl = await startDevServer(port);

  const execPath = resolveChromium();
  browser = await puppeteer.launch({
    executablePath: execPath,
    headless: "new" as any,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const t = await makeTherapist("ui-therapist");

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    // Establish the origin (login page renders for an unauthenticated visit),
    // then log in through the REAL /api/auth/login endpoint. This sets the
    // httpOnly sessionToken + readable csrfToken cookies via genuine Set-Cookie
    // headers (exactly like a real login) and seeds localStorage.currentUser,
    // which the frontend's useAuth reads to consider the user authenticated.
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await page.evaluate(async (creds) => {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(creds),
      });
      if (r.ok) {
        const user = await r.json();
        localStorage.setItem("currentUser", JSON.stringify(user));
      }
      return r.status;
    }, { username: t.username, password: "x" });
    assertEqual(loginStatus, 200, "Therapist logs in via /api/auth/login");

    // -------------------------------------------------------------------
    // Test 1: default state is ON (no preference row yet).
    // -------------------------------------------------------------------
    await page.goto(`${baseUrl}/notifications`, {
      waitUntil: "domcontentloaded",
    });
    let checked = await openPreferencesAndReadSwitch(page);
    assertEqual(
      checked,
      "true",
      "Daily schedule email toggle defaults to ON for a new therapist",
    );

    // -------------------------------------------------------------------
    // Test 2: toggle OFF, reload, and confirm it stays OFF (persisted).
    // -------------------------------------------------------------------
    const offStatus = await toggleSwitchAndAwaitPut(page);
    assertEqual(offStatus, 200, "Toggling OFF fires PUT that returns 200");

    await page.goto(`${baseUrl}/notifications`, {
      waitUntil: "domcontentloaded",
    });
    checked = await openPreferencesAndReadSwitch(page);
    assertEqual(
      checked,
      "false",
      "After reload, toggle is still OFF (opt-out persisted server-side)",
    );
    assertEqual(
      await getPersistedEmailEnabled(t.id),
      false,
      "Persisted DB preference shows email disabled after toggling OFF in the UI",
    );

    // -------------------------------------------------------------------
    // Test 3: toggle back ON, reload, and confirm it stays ON (persisted).
    // -------------------------------------------------------------------
    const onStatus = await toggleSwitchAndAwaitPut(page);
    assertEqual(onStatus, 200, "Toggling ON fires PUT that returns 200");

    await page.goto(`${baseUrl}/notifications`, {
      waitUntil: "domcontentloaded",
    });
    checked = await openPreferencesAndReadSwitch(page);
    assertEqual(
      checked,
      "true",
      "After reload, toggle is ON again (re-enable persisted server-side)",
    );
    assertEqual(
      await getPersistedEmailEnabled(t.id),
      true,
      "Persisted DB preference shows email enabled after toggling ON in the UI",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopDevServer();
    // Cleanup: remove our notification_preferences rows, then our users.
    try {
      if (createdUserIds.length > 0) {
        await db
          .delete(notificationPreferences)
          .where(inArray(notificationPreferences.userId, createdUserIds));
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

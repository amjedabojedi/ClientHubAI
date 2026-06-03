/**
 * BROWSER-LEVEL test for the PER-TRIGGER in-app / email channel switches —
 * driven through the REAL settings screen a therapist clicks, in a real
 * Chromium.
 *
 * Sibling suite test/notification-preferences-ui.test.ts already covers the
 * single "Daily schedule email" opt-out toggle. The Preferences tab ALSO
 * exposes a per-trigger row for every other notification trigger
 * (data-testid `pref-row-${triggerType}`) with two channel switches inside it:
 *   - `switch-inapp-${triggerType}`
 *   - `switch-email-${triggerType}`
 *
 * Those per-trigger switches are wired to a SEPARATE mutation
 * (setTriggerPreferenceMutation) that PUTs BOTH channel flags at once
 * ({ enableInApp, enableEmail }). A wiring regression there — wrong endpoint,
 * a missing CSRF header, the wrong field name, or a Switch that visually flips
 * but never fires the PUT — would let a therapist believe they muted a channel
 * while the server never recorded it. Only a browser test that loads the page,
 * clicks the switch, RELOADS, and re-reads it from a fresh server fetch can
 * prove the change actually round-tripped server-side rather than living in
 * local React state.
 *
 * What it does (same therapist, in order, mirroring real usage), exercising the
 * `session_scheduled` trigger:
 *   1. Loads /notifications authenticated as a therapist, opens the
 *      "Preferences" tab, and asserts BOTH the in-app and email switches
 *      default to ON (no preference row => both channels enabled in the UI).
 *   2. Flips the IN-APP switch OFF, waits for the PUT to succeed, RELOADS, and
 *      asserts in-app is still OFF while email stayed ON — proving the in-app
 *      opt-out round-tripped without clobbering the other channel. Confirms the
 *      persisted DB row too (enableInApp=false, enableEmail=true).
 *   3. Flips the EMAIL switch OFF, waits for the PUT, RELOADS, and asserts BOTH
 *      channels are now OFF. Confirms the DB row (both false).
 *   4. Flips the IN-APP switch back ON, waits for the PUT, RELOADS, and asserts
 *      in-app is ON again while email stayed OFF — proving a re-enable persists
 *      and is independent per channel. Confirms the DB row
 *      (enableInApp=true, enableEmail=false).
 *
 * Auth mirrors a logged-in browser session exactly: logging in through the real
 * /api/auth/login endpoint sets the httpOnly sessionToken + readable csrfToken
 * cookies (so the frontend's double-submit CSRF header validates) and seeds
 * localStorage.currentUser (which the frontend's useAuth reads).
 *
 * The app is spawned as a real dev server (server/index.ts via tsx) on an
 * ephemeral port so the Vite-served frontend and the Express API run together,
 * exactly like production wiring — not an in-process stub.
 *
 * Run with: npx tsx test/notification-trigger-channels-ui.test.ts
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

// The trigger row we exercise. Must be one of USER_NOTIFICATION_TRIGGER_GROUPS
// in client/src/pages/notifications.tsx.
const TRIGGER = "session_scheduled";
const INAPP_SELECTOR = `[data-testid="switch-inapp-${TRIGGER}"]`;
const EMAIL_SELECTOR = `[data-testid="switch-email-${TRIGGER}"]`;
const ROW_SELECTOR = `[data-testid="pref-row-${TRIGGER}"]`;

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

const SUFFIX = `trigchan-ui-${Date.now()}`;
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

async function getPersistedChannels(
  userId: number,
): Promise<{ enableInApp: boolean; enableEmail: boolean } | null> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.triggerType, TRIGGER),
      ),
    );
  return row ? { enableInApp: row.enableInApp, enableEmail: row.enableEmail } : null;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------
let browser: Browser;

// Open /notifications, switch to the Preferences tab, and wait for the
// per-trigger row to render.
async function openPreferences(page: any): Promise<void> {
  // The Radix Tabs only mount the active tab's content, so we must click the
  // "Preferences" tab before the row exists in the DOM. Use a real
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
  await page.waitForSelector(ROW_SELECTOR, { timeout: 30_000 });
}

// Read an aria-checked state for a switch selector.
async function readChecked(page: any, selector: string): Promise<string | null> {
  return page.$eval(selector, (el: Element) => el.getAttribute("aria-checked"));
}

// Click a switch and wait for the per-trigger PUT to succeed (status 200).
async function toggleAndAwaitPut(page: any, selector: string): Promise<number> {
  const putUrl = `/api/notifications/preferences/${TRIGGER}`;
  const [response] = await Promise.all([
    page.waitForResponse(
      (res: any) =>
        res.url().includes(putUrl) && res.request().method() === "PUT",
      { timeout: 30_000 },
    ),
    page.click(selector),
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
    // Test 1: both channels default to ON (no preference row yet).
    // -------------------------------------------------------------------
    await page.goto(`${baseUrl}/notifications`, {
      waitUntil: "domcontentloaded",
    });
    await openPreferences(page);
    assertEqual(
      await readChecked(page, INAPP_SELECTOR),
      "true",
      "In-app switch defaults to ON for a new therapist",
    );
    assertEqual(
      await readChecked(page, EMAIL_SELECTOR),
      "true",
      "Email switch defaults to ON for a new therapist",
    );

    // -------------------------------------------------------------------
    // Test 2: flip IN-APP off, reload, confirm in-app off but email still on.
    // -------------------------------------------------------------------
    assertEqual(
      await toggleAndAwaitPut(page, INAPP_SELECTOR),
      200,
      "Toggling in-app OFF fires PUT that returns 200",
    );

    await page.goto(`${baseUrl}/notifications`, {
      waitUntil: "domcontentloaded",
    });
    await openPreferences(page);
    assertEqual(
      await readChecked(page, INAPP_SELECTOR),
      "false",
      "After reload, in-app switch is still OFF (opt-out persisted server-side)",
    );
    assertEqual(
      await readChecked(page, EMAIL_SELECTOR),
      "true",
      "After reload, email switch stayed ON (other channel not clobbered)",
    );
    assertEqual(
      JSON.stringify(await getPersistedChannels(t.id)),
      JSON.stringify({ enableInApp: false, enableEmail: true }),
      "Persisted DB row: in-app disabled, email enabled after in-app OFF",
    );

    // -------------------------------------------------------------------
    // Test 3: flip EMAIL off, reload, confirm both channels off.
    // -------------------------------------------------------------------
    assertEqual(
      await toggleAndAwaitPut(page, EMAIL_SELECTOR),
      200,
      "Toggling email OFF fires PUT that returns 200",
    );

    await page.goto(`${baseUrl}/notifications`, {
      waitUntil: "domcontentloaded",
    });
    await openPreferences(page);
    assertEqual(
      await readChecked(page, INAPP_SELECTOR),
      "false",
      "After reload, in-app switch is still OFF",
    );
    assertEqual(
      await readChecked(page, EMAIL_SELECTOR),
      "false",
      "After reload, email switch is now OFF (email opt-out persisted)",
    );
    assertEqual(
      JSON.stringify(await getPersistedChannels(t.id)),
      JSON.stringify({ enableInApp: false, enableEmail: false }),
      "Persisted DB row: both channels disabled after email OFF",
    );

    // -------------------------------------------------------------------
    // Test 4: flip IN-APP back on, reload, confirm in-app on, email still off.
    // -------------------------------------------------------------------
    assertEqual(
      await toggleAndAwaitPut(page, INAPP_SELECTOR),
      200,
      "Toggling in-app back ON fires PUT that returns 200",
    );

    await page.goto(`${baseUrl}/notifications`, {
      waitUntil: "domcontentloaded",
    });
    await openPreferences(page);
    assertEqual(
      await readChecked(page, INAPP_SELECTOR),
      "true",
      "After reload, in-app switch is ON again (re-enable persisted)",
    );
    assertEqual(
      await readChecked(page, EMAIL_SELECTOR),
      "false",
      "After reload, email switch stayed OFF (re-enable is per-channel)",
    );
    assertEqual(
      JSON.stringify(await getPersistedChannels(t.id)),
      JSON.stringify({ enableInApp: true, enableEmail: false }),
      "Persisted DB row: in-app re-enabled, email still disabled",
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

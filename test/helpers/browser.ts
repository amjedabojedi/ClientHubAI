/**
 * Shared setup helpers for the BROWSER-LEVEL (puppeteer) tests.
 *
 * The browser tests drive a real Chromium against a real dev server. Every such
 * suite needs the same fragile boilerplate: pick a free port, spawn the dev
 * server and wait for /health, resolve a working Chromium binary, launch it with
 * the right flags, and authenticate in-page. Centralising it here keeps the
 * known pitfalls (documented inline below) fixed in ONE place so the suites
 * can't drift apart.
 *
 * See .agents/memory/browser-tests-puppeteer.md for the full background.
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import { createServer } from "net";
import puppeteer, { type Browser, type Page } from "puppeteer";

// ---------------------------------------------------------------------------
// Pick a free ephemeral port so our dev-server instance never collides with the
// port-5000 "Start application" server (running both at once is fine — they
// just need different ports).
// ---------------------------------------------------------------------------
export function findFreePort(): Promise<number> {
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
// Order: PUPPETEER_EXECUTABLE_PATH -> system nix `chromium` -> puppeteer's
// bundled binary. The bundled puppeteer-core is NEWER than the system Chromium
// (~125), which matters for cookie handling — see loginAs() below.
// ---------------------------------------------------------------------------
export function resolveChromium(): string | undefined {
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
// Launch a headless Chromium with the flags required to run in this sandbox.
// ---------------------------------------------------------------------------
export function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: resolveChromium(),
    headless: "new" as any,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

// ---------------------------------------------------------------------------
// Spawn the real dev server (server/index.ts via tsx) on a free ephemeral port
// and wait until it answers /health. The Vite-served frontend and the Express
// API then run together, exactly like production wiring — not an in-process
// stub. The first Vite compile can take a while, so allow a generous readiness
// deadline (120s).
// ---------------------------------------------------------------------------
export interface DevServer {
  baseUrl: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startDevServer(
  extraEnv: Record<string, string> = {},
): Promise<DevServer> {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const proc: ChildProcess = spawn("npx", ["tsx", "server/index.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      // Stub email provider config so cron startup is harmless; no email is sent.
      SPARKPOST_API_KEY: process.env.SPARKPOST_API_KEY || "test-sparkpost-key",
      EMAIL_FROM: process.env.EMAIL_FROM || "schedule@example.test",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", (d) => {
    const s = d.toString();
    if (/error/i.test(s)) console.error(`[devserver] ${s.trim()}`);
  });

  const stop = async () => {
    if (proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
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
  };

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Dev server exited early with code ${proc.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok || res.status === 503) return { baseUrl, port, stop };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stop();
  throw new Error("Dev server did not become ready within 120s");
}

// ---------------------------------------------------------------------------
// Authenticate a page exactly the way a real browser session does.
//
// IMPORTANT — do NOT use page.setCookie: the bundled puppeteer-core is newer
// than the system Chromium (~125), so page.setCookie({url,...}) throws
// `Network.deleteCookies ... partitionKey ... string value expected`.
//
// Instead, after navigating to the origin, run fetch('/api/auth/login') inside
// page.evaluate. That sets the genuine httpOnly `sessionToken` + readable
// `csrfToken` cookies via real Set-Cookie headers. We ALSO seed
// localStorage.currentUser with the returned user, because the frontend's
// useAuth reads the logged-in user from localStorage (not an API call) — without
// it the SPA renders the login page. Seeded test users may use a plaintext
// password (the login route accepts non-bcrypt passwords for compatibility).
//
// The page must already be on the app origin (call page.goto(baseUrl) first) so
// the fetch is same-origin and Set-Cookie applies. Returns the HTTP status.
// ---------------------------------------------------------------------------
export async function loginAs(
  page: Page,
  creds: { username: string; password: string },
): Promise<number> {
  return page.evaluate(async (c) => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(c),
    });
    if (r.ok) {
      const user = await r.json();
      localStorage.setItem("currentUser", JSON.stringify(user));
    }
    return r.status;
  }, creds);
}

// ---------------------------------------------------------------------------
// Radix UI interaction helper.
//
// Radix `Tabs` only mount the ACTIVE tab's content, so a control inside an
// inactive tab does not exist in the DOM until that tab is activated. A
// synthetic element.click() inside page.evaluate does NOT change the Radix tab —
// it needs a TRUSTED event. So we find the [role="tab"] whose text matches and
// drive a real ElementHandle.click().
// ---------------------------------------------------------------------------
export async function clickTab(page: Page, tabTextPattern: RegExp): Promise<void> {
  await page.waitForSelector('[role="tab"]', { timeout: 30_000 });
  const tabHandles = await page.$$('[role="tab"]');
  for (const handle of tabHandles) {
    const text = await handle.evaluate((el: Element) => el.textContent || "");
    if (tabTextPattern.test(text)) {
      await handle.click();
      return;
    }
  }
  throw new Error(`Could not find a tab matching ${tabTextPattern}`);
}

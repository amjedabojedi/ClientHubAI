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
//
// ROBUSTNESS UNDER LOAD — like clickButtonByText, this is a poll-and-retry
// LOOP. Under the heavy concurrent load of the full serial chain a freshly
// mounted tab can momentarily have no clickable point (still laying out /
// re-rendering), so a one-shot handle.click() throws "Node is either not
// clickable or not an Element". Unlike a plain <button>, a Radix tab needs a
// TRUSTED event, so we can NOT fall back to a synthetic DOM .click(); instead
// we scrollIntoView and retry the real ElementHandle.click() until the tab
// becomes clickable (or the deadline passes). See task #116.
export async function clickTab(page: Page, tabTextPattern: RegExp): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    try {
      await page.waitForSelector('[role="tab"]', {
        timeout: Math.max(1_000, deadline - Date.now()),
      });
    } catch {
      break; // no tabs at all before the deadline
    }

    const tabHandles = await page.$$('[role="tab"]');
    let matched = false;
    for (const handle of tabHandles) {
      let text = "";
      try {
        text = await handle.evaluate((el: Element) => el.textContent || "");
      } catch {
        continue; // detached during a re-render; re-query next pass
      }
      if (!tabTextPattern.test(text)) continue;
      matched = true;
      try {
        await handle.evaluate((el: Element) =>
          el.scrollIntoView({ block: "center", inline: "center" }),
        );
        await handle.click(); // trusted event — required for Radix to switch tab
        return;
      } catch (err) {
        // "not clickable" (no layout point yet) or detached mid-click: retry.
        lastErr = err;
      }
    }
    if (!matched) {
      // The tab text may not have rendered yet; wait and re-query.
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    // Matched but couldn't click it this pass; brief pause then retry.
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(
    `Could not find a tab matching ${tabTextPattern}` +
      (lastErr ? ` (last click error: ${String(lastErr)})` : ""),
  );
}

// ---------------------------------------------------------------------------
// Switch to a Radix tab BY its data-testid (when you know the tab's testid
// rather than its visible text). A Radix `TabsTrigger` needs a TRUSTED click,
// but a single one-shot click is flaky: a freshly mounted tab can be mid-remount
// when the event lands, so the click "succeeds" (no throw) yet the tab never
// switches and the inactive tab's content (and its queries) never mount. So we
// poll: re-query a fresh handle, click it, and confirm it actually became the
// active tab (data-state="active" / aria-selected="true") before returning.
// See .agents/memory/radix-tab-click-must-verify-active.md.
// ---------------------------------------------------------------------------
export async function clickTabById(page: Page, testId: string): Promise<void> {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const handle = await page.$(selector);
    if (handle) {
      try {
        await handle.evaluate((el: Element) =>
          el.scrollIntoView({ block: "center", inline: "center" }),
        );
        await handle.click(); // trusted event — required for Radix to switch tab
      } catch {
        // node detached mid-click or momentarily not clickable — retry
      }
    }
    const active = await page
      .$eval(
        selector,
        (el: Element) =>
          el.getAttribute("data-state") === "active" ||
          el.getAttribute("aria-selected") === "true",
      )
      .catch(() => false);
    if (active) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`tab ${testId} did not become active within 30s`);
}

// ---------------------------------------------------------------------------
// Click the first <button> whose visible text matches `pattern`, optionally
// scoped under `rootSelector` (defaults to "body").
//
// ROBUSTNESS UNDER LOAD — this is deliberately a poll-and-retry LOOP, not a
// single wait-then-click. The naive shape (waitForFunction that a matching
// button exists, then page.$$ + iterate once) has a time-of-check/time-of-use
// race: under the heavy concurrent load of the full serial test chain, React
// re-renders triggered by async TanStack Query data loading can DETACH and
// replace the matched button node in the window between waitForFunction
// resolving and the page.$$ snapshot being evaluated. A detached node's
// textContent reads "" so nothing matches and the old code threw
// "Could not find a button matching …" even though the button was visibly
// there a moment earlier. By re-querying and re-trying the whole find+click
// cycle until an overall deadline, a transient re-render just costs one more
// pass instead of failing the suite. See task #116 and
// .agents/memory/browser-tests-puppeteer.md.
//
// Click strategy mirrors the per-suite copies this replaces: prefer a trusted
// ElementHandle click (some handlers need a real event), but for a plain
// <button> a DOM .click() still fires its React onClick, so fall back to that
// when puppeteer can't compute a clickable point. Detached-node errors mid-
// cycle are swallowed and retried rather than surfaced.
// ---------------------------------------------------------------------------
export async function clickButtonByText(
  page: Page,
  pattern: RegExp,
  rootSelector?: string,
): Promise<void> {
  const root = rootSelector ?? "body";
  const deadline = Date.now() + 30_000;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    // Wait for a button whose text MATCHES to be present (not merely for any
    // button to exist). After a navigation or tab switch the target button —
    // and its async data — mount a beat later, so this is the "appears later"
    // case. Bound the wait by the overall deadline.
    try {
      await page.waitForFunction(
        (sel: string, src: string) => {
          const re = new RegExp(src);
          return Array.from(document.querySelectorAll(`${sel} button`)).some((b) =>
            re.test((b.textContent || "").trim()),
          );
        },
        { timeout: Math.max(1_000, deadline - Date.now()) },
        root,
        pattern.source,
      );
    } catch {
      break; // overall deadline reached without a match
    }

    const handles = await page.$$(`${root} button`);
    for (const handle of handles) {
      let text = "";
      try {
        text = await handle.evaluate((el: Element) => (el.textContent || "").trim());
      } catch {
        // Node detached during a re-render between the snapshot and this read;
        // skip it and let the loop re-query.
        continue;
      }
      if (!pattern.test(text)) continue;

      try {
        await handle.evaluate((el: Element) =>
          el.scrollIntoView({ block: "center", inline: "center" }),
        );
        await handle.click();
        return;
      } catch (err) {
        const msg = String(err);
        if (/not clickable or not an Element/i.test(msg)) {
          // Inside a drawer scroll/overlay region puppeteer can't compute a
          // clickable point; a DOM click still fires React's onClick.
          try {
            await handle.evaluate((el: Element) => (el as HTMLElement).click());
            return;
          } catch (domErr) {
            lastErr = domErr; // detached mid-click — retry the whole cycle
          }
        } else {
          lastErr = err; // likely detached mid-click — retry the whole cycle
        }
      }
    }

    // Matched a button this pass but couldn't click it (it raced out from
    // under us). Brief pause, then re-query from scratch.
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(
    `Could not find a button matching ${pattern} under ${root}` +
      (lastErr ? ` (last click error: ${String(lastErr)})` : ""),
  );
}

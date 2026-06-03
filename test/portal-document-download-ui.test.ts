/**
 * BROWSER-LEVEL test for the client portal DOCUMENT DOWNLOAD button — the
 * loading/disabled state and the failure toast (added in Task #84). Driven
 * through the REAL portal documents screen in a real Chromium.
 *
 * Why this exists:
 *   The download buttons used to "fail silently": a click fired a fetch and, if
 *   the server returned a non-OK response, nothing happened — no spinner while
 *   it ran, no error if it failed. Task #84 added a per-document loading state
 *   (the button disables and swaps the Download icon for a spinner while the
 *   fetch is in flight) and a destructive toast when the fetch returns non-OK.
 *   Nothing guarded that behavior, so a future refactor could quietly revert it.
 *
 * What it proves (in order, same page session):
 *   1. While a download is IN FLIGHT, the document's download button becomes
 *      disabled and shows the spinner (Loader2 .animate-spin) — not the static
 *      Download icon. After the response arrives the button re-enables.
 *   2. When the download endpoint returns a non-OK response, a "Download Failed"
 *      destructive toast appears carrying the server's error message, instead of
 *      the click doing nothing. The button also returns to an enabled state.
 *
 * How it stays deterministic WITHOUT any DB seeding or Azure blob:
 *   The portal documents route (/portal/documents) renders without staff auth
 *   (see client/src/App.tsx Router) and only needs GET /api/portal/documents to
 *   populate the table. We use puppeteer request interception to:
 *     - return a single fake document for GET /api/portal/documents, and
 *     - control the .../download endpoint precisely:
 *         * "delay" mode HOLDS the response open (so the in-flight UI state is
 *           observable), then releases it 200 OK, and
 *         * "fail" mode returns 500 with a JSON { message } body, which
 *           downloadFile() surfaces to the failure toast.
 *   Everything else is continue()'d untouched (Vite assets, the SPA, etc.).
 *
 * The app is spawned as a real dev server (server/index.ts via tsx) on an
 * ephemeral port so the Vite-served frontend and Express API run together.
 *
 * Run with: npx tsx test/portal-document-download-ui.test.ts
 *
 * NOTES:
 * - No DB writes: the document list and download endpoint are fully mocked at
 *   the network layer, so there is nothing to seed or clean up.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md).
 * - Uses the system Chromium with --no-sandbox (via the shared browser helper).
 */

import type { Browser, HTTPRequest } from "puppeteer";
import { startDevServer, launchBrowser, type DevServer } from "./helpers/browser";

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

// ---------------------------------------------------------------------------
// Mock document + endpoints
// ---------------------------------------------------------------------------
const DOC_ID = 987654; // arbitrary, won't collide with real rows
const FAKE_DOC = {
  id: DOC_ID,
  fileName: `${DOC_ID}-report.pdf`,
  originalName: "Treatment Summary.pdf",
  fileSize: 20480,
  mimeType: "application/pdf",
  category: "shared",
  createdAt: new Date("2026-01-15T10:00:00.000Z").toISOString(),
  uploadedBy: { fullName: "Test Therapist" },
};
const FAIL_MESSAGE = "Storage is temporarily unavailable. Please try again.";

const DOWNLOAD_BTN = `[data-testid="button-download-${DOC_ID}"]`;
const DOWNLOAD_PATH = `/api/portal/documents/${DOC_ID}/download`;

// Controls how the intercepted download endpoint behaves.
type DownloadMode = "delay" | "fail";
let downloadMode: DownloadMode = "delay";

// For "delay" mode: signal when the request reaches our handler, and a gate the
// test releases once it has asserted the in-flight UI state.
let signalStarted: () => void = () => {};
let startedPromise: Promise<void> = new Promise((r) => (signalStarted = r));
let releaseDownload: () => void = () => {};
let releasePromise: Promise<void> = new Promise((r) => (releaseDownload = r));

// ---------------------------------------------------------------------------
let browser: Browser;
let devServer: DevServer | null = null;

async function main() {
  devServer = await startDevServer();
  const baseUrl = devServer.baseUrl;

  browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.setRequestInterception(true);
    page.on("request", async (req: HTTPRequest) => {
      try {
        const url = req.url();

        // Download endpoint — controlled per-test.
        if (url.includes(DOWNLOAD_PATH)) {
          if (downloadMode === "fail") {
            await req.respond({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({ message: FAIL_MESSAGE }),
            });
            return;
          }
          // "delay": hold the response open so the in-flight UI is observable.
          signalStarted();
          await releasePromise;
          await req.respond({
            status: 200,
            headers: {
              "Content-Disposition": 'attachment; filename="Treatment Summary.pdf"',
            },
            contentType: "application/pdf",
            body: "%PDF-1.4 fake body",
          });
          return;
        }

        // Document list — return our single fake document.
        if (url.endsWith("/api/portal/documents")) {
          await req.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([FAKE_DOC]),
          });
          return;
        }

        await req.continue();
      } catch {
        // If the request was already handled/aborted, ignore.
        try {
          await req.continue();
        } catch {
          /* noop */
        }
      }
    });

    await page.goto(`${baseUrl}/portal/documents`, {
      waitUntil: "domcontentloaded",
    });

    // The mocked document row + its download button should render.
    await page.waitForSelector(DOWNLOAD_BTN, { timeout: 30_000 });

    // -------------------------------------------------------------------
    // Test 1: download in flight => button disabled + spinner, then re-enabled.
    // -------------------------------------------------------------------
    const disabledBefore = await page.$eval(DOWNLOAD_BTN, (el) =>
      el.hasAttribute("disabled"),
    );
    assertEqual(disabledBefore, false, "Download button is enabled before clicking");

    const spinnerBefore = await page.$(`${DOWNLOAD_BTN} .animate-spin`);
    assertEqual(
      spinnerBefore === null,
      true,
      "No spinner is shown before the download starts",
    );

    downloadMode = "delay";
    await page.click(DOWNLOAD_BTN);

    // Wait until the fetch actually reaches our (held) handler.
    await startedPromise;

    // While the response is held open, the button must be disabled and spinning.
    await page.waitForSelector(`button${DOWNLOAD_BTN}:disabled`, {
      timeout: 10_000,
    });
    assertEqual(
      true,
      true,
      "Download button becomes disabled while the download is in flight",
    );

    const spinnerDuring = await page.$(`${DOWNLOAD_BTN} .animate-spin`);
    assertEqual(
      spinnerDuring !== null,
      true,
      "A spinner (Loader2 .animate-spin) is shown while the download is in flight",
    );

    // Release the held response and confirm the button re-enables.
    releaseDownload();
    await page.waitForFunction(
      (sel: string) => {
        const b = document.querySelector(sel);
        return !!b && !b.hasAttribute("disabled");
      },
      { timeout: 10_000 },
      DOWNLOAD_BTN,
    );
    assertEqual(
      true,
      true,
      "Download button re-enables after the download completes",
    );

    // -------------------------------------------------------------------
    // Test 2: a non-OK download surfaces an error toast (not a silent no-op).
    // -------------------------------------------------------------------
    downloadMode = "fail";
    await page.click(DOWNLOAD_BTN);

    // A destructive "Download Failed" toast carrying the server message appears.
    await page.waitForFunction(
      () => document.body.innerText.includes("Download Failed"),
      { timeout: 10_000 },
    );
    const bodyText = await page.evaluate(() => document.body.innerText);
    assertEqual(
      bodyText.includes("Download Failed"),
      true,
      'A "Download Failed" toast appears when the download returns a non-OK response',
    );
    assertEqual(
      bodyText.includes(FAIL_MESSAGE),
      true,
      "The failure toast surfaces the server's error message",
    );

    // The button is not left stuck in a disabled/spinning state after failure.
    await page.waitForFunction(
      (sel: string) => {
        const b = document.querySelector(sel);
        return !!b && !b.hasAttribute("disabled");
      },
      { timeout: 10_000 },
      DOWNLOAD_BTN,
    );
    const spinnerAfterFail = await page.$(`${DOWNLOAD_BTN} .animate-spin`);
    assertEqual(
      spinnerAfterFail === null,
      true,
      "No spinner remains after a failed download (button reset)",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (devServer) await devServer.stop();
  }

  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  if (testsFailed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});

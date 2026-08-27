/**
 * BROWSER-LEVEL regression test for session-note PDF actions in Session History.
 *
 * The server-level PDF tests prove the response is authenticated, valid PDF
 * bytes, and advertises the expected filename. This suite covers the user-facing
 * path: a logged-in therapist opens a client's Sessions tab, clicks Download PDF,
 * and the browser turns the response into a file download. It also verifies that
 * both download and preview actions remain usable when PDF generation fails.
 *
 * Run with: npx tsx test/session-note-pdf-browser.test.ts
 *
 * This suite is DB-backed and must run serially with the other app-level tests.
 */

import type { Browser, HTTPRequest, Page } from "puppeteer";
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
  sessions,
  sessionNotes,
} from "../shared/schema";
import { inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
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

const SUFFIX = `t-pdf-browser-${Date.now()}`;
const FAIL_MESSAGE = `PDF generation unavailable ${SUFFIX}`;

const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdSessionIds: number[] = [];
const createdSessionNoteIds: number[] = [];

type PdfMode = "success" | "fail";

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

// The menu trigger and menu item are Radix controls. Use a trusted click so the
// menu's pointer event path is exercised instead of a synthetic DOM click.
async function trustedClick(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: 30_000 });
  const handle = await page.$(selector);
  if (!handle) throw new Error(`Could not find element to click: ${selector}`);
  await handle.evaluate((el: Element) =>
    el.scrollIntoView({ block: "center", inline: "center" }),
  );
  await handle.click();
}

async function openSessionMenu(page: Page, sessionId: number): Promise<void> {
  await trustedClick(page, `[data-testid="session-menu-trigger-${sessionId}"]`);
  await page.waitForSelector(`[data-testid="menu-download-pdf-${sessionId}"]`, {
    timeout: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function seed() {
  const therapist = await storage.createUser({
    username: `pdf-browser-therapist-${SUFFIX}`,
    password: "x",
    fullName: `PDF Browser Therapist ${SUFFIX}`,
    email: `pdf-browser-therapist-${SUFFIX}@example.test`,
    role: "therapist",
  } as any);
  createdUserIds.push(therapist.id);

  // Use an explicit client id rather than storage.createClient's MAX+1
  // derivation, which races with concurrently running app-level suites.
  const [client] = await db
    .insert(clients)
    .values({
      clientId: `T${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20),
      fullName: `PDF Browser Client ${SUFFIX}`,
      assignedTherapistId: therapist.id,
    } as any)
    .returning();
  createdClientIds.push(client.id);

  const [service] = await db
    .insert(services)
    .values({
      serviceCode: `PDF-BROWSER-${SUFFIX}`.slice(0, 50),
      serviceName: `PDF Browser Service ${SUFFIX}`,
      duration: 60,
      baseRate: "100.00",
      isActive: true,
      therapistVisible: true,
      clientPortalVisible: true,
    } as any)
    .returning();
  createdServiceIds.push(service.id);

  const [session] = await db
    .insert(sessions)
    .values({
      clientId: client.id,
      therapistId: therapist.id,
      serviceId: service.id,
      sessionDate: new Date("2026-08-27T15:00:00.000Z"),
      sessionType: "individual",
      status: "completed",
    } as any)
    .returning();
  createdSessionIds.push(session.id);

  const [note] = await db
    .insert(sessionNotes)
    .values({
      sessionId: session.id,
      clientId: client.id,
      therapistId: therapist.id,
      date: new Date("2026-08-27T15:05:00.000Z"),
      finalContent: `<p>Browser PDF marker ${SUFFIX}</p>`,
      generatedContent: `<p>Generated fallback ${SUFFIX}</p>`,
      draftContent: `<p>Draft fallback ${SUFFIX}</p>`,
      isDraft: false,
      isFinalized: true,
      finalizedAt: new Date("2026-08-27T16:00:00.000Z"),
      aiEnabled: false,
    } as any)
    .returning();
  createdSessionNoteIds.push(note.id);

  return { therapist, client, session, note };
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------
let browser: Browser | null = null;
let devServer: DevServer | null = null;

async function main() {
  let page: Page | null = null;

  try {
    const { therapist, client, session, note } = await seed();
    devServer = await startDevServer();
    browser = await launchBrowser();

    page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    const pdfPath = `/api/session-notes/${note.id}/pdf`;
    let pdfMode: PdfMode = "success";

    await page.setRequestInterception(true);
    page.on("request", async (request: HTTPRequest) => {
      try {
        if (request.url().endsWith(pdfPath) && pdfMode === "fail") {
          await request.respond({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ message: FAIL_MESSAGE }),
          });
          return;
        }
        await request.continue();
      } catch {
        // A navigation or browser close can race request handling. Do not let
        // an already-aborted request turn into a false test failure.
        try {
          await request.continue();
        } catch {
          /* noop */
        }
      }
    });

    await page.goto(devServer.baseUrl, { waitUntil: "domcontentloaded" });
    assertEqual(
      await loginAs(page, { username: therapist.username, password: "x" }),
      200,
      "Therapist logs in through the browser login endpoint",
    );

    await page.goto(
      `${devServer.baseUrl}/clients/${client.id}?tab=sessions`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForSelector(
      `[data-testid="button-preview-pdf-${session.id}"]`,
      { timeout: 45_000 },
    );

    // Install browser-side download capture after the target-page navigation.
    // The application still performs the real fetch and creates a real Blob;
    // the wrapper only records the resulting bytes and anchor filename before
    // the browser navigates it.
    await page.evaluate(
      "window.__name = window.__name || function (f) { return f; };",
    );
    await page.evaluate(() => {
      const w = window as any;
      w.__sessionPdfDownload = null;

      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      (URL as any).createObjectURL = (blob: Blob) => {
        blob
          .slice(0, 5)
          .arrayBuffer()
          .then((buffer) => {
            const previous = w.__sessionPdfDownload || {};
            w.__sessionPdfDownload = {
              ...previous,
              mimeType: blob.type,
              size: blob.size,
              signature: Array.from(new Uint8Array(buffer)),
            };
          });
        return originalCreateObjectURL(blob);
      };

      const originalAnchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        const previous = w.__sessionPdfDownload || {};
        w.__sessionPdfDownload = {
          ...previous,
          clicked: true,
          filename: this.download,
        };
        return originalAnchorClick.call(this);
      };
    });

    // -----------------------------------------------------------------------
    // Test 1: Download PDF uses the real PDF response and Content-Disposition.
    // -----------------------------------------------------------------------
    await openSessionMenu(page, session.id);
    const [pdfResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(pdfPath) &&
          response.request().method() === "GET",
        { timeout: 60_000 },
      ),
      trustedClick(
        page,
        `[data-testid="menu-download-pdf-${session.id}"]`,
      ),
    ]);

    assertEqual(pdfResponse.status(), 200, "Download action receives a successful PDF response");
    assertEqual(
      pdfResponse.headers()["content-type"],
      "application/pdf",
      "Download action receives application/pdf",
    );
    assertEqual(
      pdfResponse.headers()["content-disposition"],
      `inline; filename="session-note-${note.id}.pdf"`,
      "PDF response provides the expected session-note filename",
    );

    await page.waitForFunction(
      () => {
        const download = (window as any).__sessionPdfDownload;
        return (
          download?.clicked === true &&
          download?.mimeType === "application/pdf" &&
          download?.size > 0 &&
          Array.isArray(download?.signature) &&
          download.signature.join(",") === "37,80,68,70,45"
        );
      },
      { timeout: 30_000 },
    );
    const capturedDownload = await page.evaluate(
      () => (window as any).__sessionPdfDownload,
    );
    assertEqual(
      capturedDownload.filename,
      `session-note-${note.id}.pdf`,
      "Browser download anchor uses the expected session-note filename",
    );
    assert(
      capturedDownload.size > 0 &&
        capturedDownload.signature.join(",") === "37,80,68,70,45",
      "Browser download contains a real PDF signature",
    );

    // -----------------------------------------------------------------------
    // Test 2: Download failure surfaces an error and leaves the UI usable.
    // -----------------------------------------------------------------------
    pdfMode = "fail";
    await openSessionMenu(page, session.id);
    await trustedClick(page, `[data-testid="menu-download-pdf-${session.id}"]`);
    await page.waitForFunction(
      () => document.body.innerText.includes("Error downloading PDF"),
      { timeout: 15_000 },
    );
    const downloadFailureText = await page.evaluate(() => document.body.innerText);
    assert(
      downloadFailureText.includes("Error downloading PDF"),
      "Download failure displays a visible error toast",
    );
    assert(
      downloadFailureText.includes(FAIL_MESSAGE),
      "Download failure surfaces the server error message",
    );
    assertEqual(
      await page.$(`[data-testid="button-preview-pdf-${session.id}"]`) !== null,
      true,
      "Session History remains usable after a failed download",
    );

    // -----------------------------------------------------------------------
    // Test 3: Preview failure closes its temporary window and shows an error.
    // -----------------------------------------------------------------------
    await trustedClick(
      page,
      `[data-testid="button-preview-pdf-${session.id}"]`,
    );
    await page.waitForFunction(
      () => document.body.innerText.includes("Error generating PDF preview"),
      { timeout: 15_000 },
    );
    const previewFailureText = await page.evaluate(() => document.body.innerText);
    assert(
      previewFailureText.includes("Error generating PDF preview"),
      "Preview failure displays a visible error toast",
    );
    assert(
      previewFailureText.includes(FAIL_MESSAGE),
      "Preview failure surfaces the server error message",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (devServer) await devServer.stop();

    try {
      if (createdSessionNoteIds.length > 0) {
        await db
          .delete(sessionNotes)
          .where(inArray(sessionNotes.id, createdSessionNoteIds));
      }
      if (createdSessionIds.length > 0) {
        await db
          .delete(sessions)
          .where(inArray(sessions.id, createdSessionIds));
      }
      if (createdClientIds.length > 0) {
        await db
          .delete(clients)
          .where(inArray(clients.id, createdClientIds));
      }
      if (createdServiceIds.length > 0) {
        await db
          .delete(services)
          .where(inArray(services.id, createdServiceIds));
      }
      if (createdUserIds.length > 0) {
        await db
          .delete(users)
          .where(inArray(users.id, createdUserIds));
      }
      console.log("\n🧹 Cleanup complete.");
    } catch (cleanupError) {
      console.error("⚠️ Cleanup error:", cleanupError);
      testsFailed++;
    }
  }

  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  if (testsFailed > 0) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal test error:", error);
  process.exit(1);
});
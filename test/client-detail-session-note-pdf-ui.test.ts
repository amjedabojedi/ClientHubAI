/**
 * Browser-level regression coverage for Client Detail's session-note PDF actions.
 *
 * The page previously treated the new binary PDF response as text and wrote it
 * into a blank browser window. This test clicks the real View PDF and Download
 * PDF controls to ensure the preview navigates to a PDF blob and the download
 * action requests a real PDF instead of opening the print dialog.
 *
 * Run with: npx tsx test/client-detail-session-note-pdf-ui.test.ts
 */

import type { Browser, Page } from "puppeteer";
import {
  startDevServer,
  launchBrowser,
  loginAs,
  type DevServer,
} from "./helpers/browser";
import { db } from "../server/db";
import {
  users,
  clients,
  services,
  sessions,
  sessionNotes,
} from "../shared/schema";
import { storage } from "../server/storage";
import { inArray } from "drizzle-orm";

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

const SUFFIX = `client-note-pdf-ui-${Date.now()}`;
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdSessionIds: number[] = [];
const createdSessionNoteIds: number[] = [];

async function seed() {
  const admin = await storage.createUser({
    username: `pdf-ui-admin-${SUFFIX}`,
    password: "x",
    fullName: `PDF UI Admin ${SUFFIX}`,
    email: `pdf-ui-admin-${SUFFIX}@example.test`,
    role: "admin",
  } as any);
  createdUserIds.push(admin.id);

  const client = await storage.createClient({
    fullName: `PDF UI Client ${SUFFIX}`,
    assignedTherapistId: admin.id,
  } as any);
  createdClientIds.push(client.id);

  const service = await storage.createService({
    serviceCode: `PDF-UI-${SUFFIX}`.slice(0, 50),
    serviceName: `PDF UI Test Service ${SUFFIX}`,
    duration: 60,
    baseRate: "100.00",
    isActive: true,
    therapistVisible: true,
    clientPortalVisible: true,
  } as any);
  createdServiceIds.push(service.id);

  const session = await storage.createSession({
    clientId: client.id,
    therapistId: admin.id,
    serviceId: service.id,
    sessionDate: new Date(),
    sessionType: "individual",
    status: "completed",
  } as any);
  createdSessionIds.push(session.id);

  const note = await storage.createSessionNote({
    sessionId: session.id,
    clientId: client.id,
    therapistId: admin.id,
    date: new Date(),
    finalContent: `<p>Client Detail PDF UI marker ${SUFFIX}</p>`,
    isDraft: false,
    isFinalized: true,
    finalizedAt: new Date(),
    aiEnabled: false,
  } as any);
  createdSessionNoteIds.push(note.id);

  return { admin, client, session, note };
}

async function clickMenuItem(page: Page, text: string): Promise<void> {
  await page.waitForFunction(
    (expected: string) =>
      Array.from(document.querySelectorAll('[role="menuitem"]')).some(
        (item) => (item.textContent || "").trim() === expected,
      ),
    { timeout: 30_000 },
    text,
  );

  const items = await page.$$('[role="menuitem"]');
  for (const item of items) {
    const itemText = await item.evaluate((element) => (element.textContent || "").trim());
    if (itemText === text) {
      await item.click();
      return;
    }
  }
  throw new Error(`Could not click menu item "${text}"`);
}

async function main() {
  let devServer: DevServer | null = null;
  let browser: Browser | null = null;

  try {
    devServer = await startDevServer();
    browser = await launchBrowser();
    const { admin, client, session, note } = await seed();

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);
    await page.goto(devServer.baseUrl, { waitUntil: "domcontentloaded" });

    const loginStatus = await loginAs(page, {
      username: admin.username,
      password: "x",
    });
    assertEqual(loginStatus, 200, "Admin logs in for the client-detail PDF test");

    await page.goto(`${devServer.baseUrl}/clients/${client.id}?tab=sessions`, {
      waitUntil: "domcontentloaded",
    });
    const previewSelector = `[data-testid="button-preview-pdf-${session.id}"]`;
    await page.waitForSelector(previewSelector, { timeout: 30_000 });

    const pdfPath = `/api/session-notes/${note.id}/pdf`;
    const previewResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === pdfPath &&
        response.request().method() === "GET",
      { timeout: 30_000 },
    );
    const popupTarget = browser.waitForTarget(
      (target) => target.type() === "page" && target.opener() === page.target(),
      { timeout: 30_000 },
    );

    const previewButton = await page.$(previewSelector);
    await previewButton!.click();

    const response = await previewResponse;
    assertEqual(response.status(), 200, "View PDF control receives a successful PDF response");
    assertEqual(
      response.headers()["content-type"],
      "application/pdf",
      "View PDF control receives application/pdf",
    );
    assert(
      Number(response.headers()["content-length"]) > 0,
      "View PDF control receives a non-empty PDF response",
    );

    const target = await popupTarget;
    const popup = await target.page();
    if (!popup) throw new Error("View PDF did not open a browser page");
    await popup.waitForFunction(() => location.href !== "about:blank", {
      timeout: 30_000,
    });
    const popupState = await popup.evaluate(() => ({
      href: location.href,
      text: document.body?.innerText?.slice(0, 20) || "",
    }));
    assert(
      popupState.href.startsWith("blob:") ||
        popupState.href.startsWith("chrome-extension:"),
      "View PDF preview navigates to a PDF blob/viewer rather than remaining a blank document",
    );
    assert(
      !popupState.text.startsWith("%PDF-"),
      "View PDF preview never writes raw PDF bytes into the document",
    );
    await popup.close();
    await page.bringToFront();

    const menuTrigger = `[data-testid="session-menu-trigger-${session.id}"]`;
    await page.waitForSelector(menuTrigger, { timeout: 30_000 });
    const downloadResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === pdfPath &&
        response.request().method() === "GET",
      { timeout: 30_000 },
    );
    const trigger = await page.$(menuTrigger);
    await trigger!.click();
    await clickMenuItem(page, "Download PDF");

    const download = await downloadResponse;
    assertEqual(download.status(), 200, "Download PDF control receives a successful PDF response");
    assertEqual(
      download.headers()["content-type"],
      "application/pdf",
      "Download PDF control receives application/pdf",
    );
    assertEqual(
      download.headers()["content-disposition"],
      `inline; filename="session-note-${note.id}.pdf"`,
      "Download PDF control receives the expected filename",
    );
    assert(
      Number(download.headers()["content-length"]) > 0,
      "Download PDF control receives a non-empty PDF response",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (devServer) await devServer.stop();

    try {
      if (createdSessionNoteIds.length > 0) {
        await db.delete(sessionNotes).where(inArray(sessionNotes.id, createdSessionNoteIds));
      }
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
    } catch (cleanupError) {
      console.error("⚠️ Cleanup error:", cleanupError);
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
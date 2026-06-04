/**
 * BROWSER-LEVEL test for the migrated client-detail slide-over drawers.
 *
 * Task #105 moved five staff dialogs on the client-detail page out of Radix
 * <Dialog>s and into the RecordDrawer slide-over system. Their bodies are no
 * longer rendered by their own Dialog — they are PORTALED (createPortal) into a
 * single host outlet, and they open/close through the drawer stack
 * (openInlineDrawer / closeTopDrawer) instead of local boolean useState.
 *
 * The five migrated drawers:
 *   1. upload-document    — "Upload Document"          (Documents tab button)
 *   2. document-review    — "Review Document"          (Documents tab "Review Now")
 *   3. document-preview   — "Document Preview"         (opened FROM the review
 *                                                       drawer → stacks to depth 2)
 *   4. assign-checklist   — "Assign Checklist Template"(Checklists tab button)
 *   5. payment-record     — "Record Payment"           (Billing tab "Pay" button)
 *
 * Because these bodies now share ONE outlet and one Sheet, a regression (wrong
 * inlineKey, a portal guard that never matches, a close that pops the wrong
 * level, or the review→preview stack failing to push/pop) would silently break
 * staff workflows and is invisible to typecheck/unit tests. Only a real-browser
 * test that clicks each trigger, reads the rendered drawer title, exercises the
 * two-level stack, and confirms closeTopDrawer pops exactly one level can prove
 * the migration still works end to end.
 *
 * What it does (logged in as an admin, against a real dev server in Chromium):
 *   1. Documents tab → "Upload Document" → asserts the drawer title is
 *      "Upload Document", then Escape (→ closeTopDrawer) and asserts it closes.
 *   2. Documents tab → "Review Now" (a seeded pending-review document) → asserts
 *      "Review Document"; then the in-drawer "Preview" button pushes a SECOND
 *      drawer "Document Preview" (stack depth 2, breadcrumb visible). Escape pops
 *      just the preview (back to "Review Document"); Escape again closes the stack.
 *   3. Checklists tab → "Assign Checklist Template" → asserts the title, closes.
 *   4. Billing tab → "Pay" (a seeded pending billing record) → asserts
 *      "Record Payment", closes.
 *
 * Auth + server wiring mirror the sibling browser suites exactly (see
 * test/helpers/browser.ts and .agents/memory/browser-tests-puppeteer.md):
 * a real dev server on an ephemeral port, in-page /api/auth/login, and
 * localStorage.currentUser seeded for the SPA's useAuth.
 *
 * Run with: npx tsx test/client-detail-drawers-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a dedicated admin, client, service, session, one pending
 *   billing record, and one pending-review document; all removed at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md).
 */

import type { Browser, Page } from "puppeteer";
import {
  startDevServer,
  launchBrowser,
  loginAs,
  clickButtonByText,
  type DevServer,
} from "./helpers/browser";
import { db } from "../server/db";
import {
  users,
  clients,
  services,
  sessions,
  sessionBilling,
  documents,
} from "../shared/schema";
import { storage } from "../server/storage";
import { eq, inArray } from "drizzle-orm";

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

const SUFFIX = `cd-drawers-ui-${Date.now()}`;
const DRAWER = '[data-testid="record-drawer"]';
const TITLE = '[data-testid="record-drawer-title"]';

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
    fullName: `Drawer Client ${SUFFIX}`,
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

  const session = await storage.createSession({
    clientId: client.id,
    therapistId: admin.id,
    serviceId: service.id,
    sessionDate: new Date(),
    sessionType: "individual",
    status: "completed",
  } as any);
  createdSessionIds.push(session.id);

  // One PENDING billing record so the Billing tab shows a "Pay" button that
  // opens the payment-record drawer.
  await db.insert(sessionBilling).values({
    sessionId: session.id,
    serviceCode: service.serviceCode,
    units: 1,
    ratePerUnit: "120.00",
    totalAmount: "120.00",
    paymentStatus: "pending",
    billingDate: new Date().toISOString().split("T")[0],
  } as any);

  // One PENDING-REVIEW document so the Documents tab shows a "Review Now"
  // button that opens the document-review drawer. PDF mimeType keeps the
  // document-preview render network-free (no <img> fetch).
  await storage.createDocument({
    clientId: client.id,
    uploadedById: admin.id,
    fileName: `seeded-${SUFFIX}.pdf`,
    originalName: `seeded-${SUFFIX}.pdf`,
    fileSize: 2048,
    mimeType: "application/pdf",
    category: "uploaded",
    reviewStatus: "pending_review",
  } as any);

  return { admin, client };
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

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

// Close the top drawer the same way the UI does (Escape → Sheet onOpenChange →
// closeTopDrawer → history.back). Returns once the popstate has settled.
async function pressEscape(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
}

async function waitForDrawerClosed(page: Page): Promise<void> {
  await page.waitForFunction(
    (sel: string) => !document.querySelector(sel),
    { timeout: 30_000 },
    DRAWER,
  );
}

async function gotoTab(page: Page, baseUrl: string, clientId: number, tab: string) {
  await page.goto(`${baseUrl}/clients/${clientId}?tab=${tab}`, {
    waitUntil: "domcontentloaded",
  });
  // Wait for the client-detail page to render its tab content area.
  await page.waitForSelector('[role="tablist"], main, body', { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
let browser: Browser;
let devServer: DevServer | null = null;

async function main() {
  devServer = await startDevServer();
  const baseUrl = devServer.baseUrl;
  browser = await launchBrowser();

  try {
    const { admin, client } = await seed();

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await loginAs(page, { username: admin.username, password: "x" });
    assertEqual(loginStatus, 200, "Admin logs in via /api/auth/login");

    // -------------------------------------------------------------------
    // NESTED FLOW — the "empty nested drawer" bug.
    //
    // Open the client's profile as a WIDE DRAWER from the Clients LIST
    // (depth 1), then open "Record Payment" on top of it (depth 2). The
    // lower client-detail drawer is the component that PORTALS the payment
    // body into the host outlet, so it must stay mounted while the child is
    // on top — otherwise the Record Payment drawer comes up empty. The
    // other scenarios below drive the /clients/:id ROUTE flow (where the
    // page stays mounted because it owns the route), so only THIS scenario
    // exercises the drawer-over-drawer case the fix targets. Placed first so
    // a later (unrelated) failure can't mask it.
    // -------------------------------------------------------------------
    await page.goto(`${baseUrl}/clients`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-testid="button-view-${client.id}"]`, {
      timeout: 30_000,
    });
    {
      const viewBtn = await page.$(`[data-testid="button-view-${client.id}"]`);
      await viewBtn!.click();
    }
    await waitForDrawerTitle(page, `Drawer Client ${SUFFIX}`);
    assertEqual(
      await getDrawerTitle(page),
      `Drawer Client ${SUFFIX}`,
      "Clients list opens the client profile as a wide drawer",
    );

    // Switch to the Billing tab inside the drawer, then click "Pay".
    await page.waitForSelector(`${DRAWER} [data-testid="tab-billing"]`, {
      timeout: 30_000,
    });
    {
      const billingTab = await page.$(`${DRAWER} [data-testid="tab-billing"]`);
      await billingTab!.click();
    }
    // The billing records load asynchronously once the tab is active;
    // clickButtonByText polls for the matching "Pay" button before clicking.
    await clickButtonByText(page, /^Pay$/, DRAWER);
    await waitForDrawerTitle(page, "Record Payment");
    assertEqual(
      await getDrawerTitle(page),
      "Record Payment",
      "Record Payment opens as a second drawer over the client profile",
    );
    // Depth 2 is confirmed by the breadcrumb back to the client profile.
    assertEqual(
      (await page.$('[data-testid="breadcrumb-drawer-0"]')) !== null,
      true,
      "Nested Record Payment shows a breadcrumb back to the client profile",
    );
    // THE FIX: the payment form body actually renders (not an empty drawer).
    const nestedBodyRendered = await page
      .waitForSelector(`${DRAWER} #payment-amount`, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    assertEqual(
      nestedBodyRendered,
      true,
      "Nested Record Payment renders its form body (the empty-nested-drawer fix)",
    );
    // Pop one level: the client profile beneath is revealed, still mounted.
    await pressEscape(page);
    await waitForDrawerTitle(page, `Drawer Client ${SUFFIX}`);
    assertEqual(
      await getDrawerTitle(page),
      `Drawer Client ${SUFFIX}`,
      "Closing Record Payment reveals the client profile beneath it",
    );
    // Pop the last level: stack empty.
    await pressEscape(page);
    await waitForDrawerClosed(page);

    // -------------------------------------------------------------------
    // Drawer 1: upload-document
    // -------------------------------------------------------------------
    await gotoTab(page, baseUrl, client.id, "documents");
    await clickButtonByText(page, /^Upload Document$/);
    await waitForDrawerTitle(page, "Upload Document");
    assertEqual(
      await getDrawerTitle(page),
      "Upload Document",
      "Upload Document trigger opens the upload-document drawer",
    );
    await pressEscape(page);
    await waitForDrawerClosed(page);
    assertEqual(
      await drawerIsOpen(page),
      false,
      "Escape (closeTopDrawer) closes the upload-document drawer",
    );

    // -------------------------------------------------------------------
    // Drawer 2 + 3: document-review → document-preview (stack depth 2)
    // -------------------------------------------------------------------
    await gotoTab(page, baseUrl, client.id, "documents");
    await clickButtonByText(page, /Review Now/);
    await waitForDrawerTitle(page, "Review Document");
    assertEqual(
      await getDrawerTitle(page),
      "Review Document",
      "Review Now trigger opens the document-review drawer",
    );

    // No breadcrumb at depth 1.
    assertEqual(
      (await page.$('[data-testid="breadcrumb-drawer-0"]')) !== null,
      false,
      "At depth 1 the review drawer shows no breadcrumb",
    );

    // The in-drawer Preview button pushes the SECOND drawer.
    await clickButtonByText(page, /^Preview$/, DRAWER);
    await waitForDrawerTitle(page, "Document Preview");
    assertEqual(
      await getDrawerTitle(page),
      "Document Preview",
      "In-review Preview button stacks the document-preview drawer (depth 2)",
    );
    assertEqual(
      (await page.$('[data-testid="breadcrumb-drawer-0"]')) !== null,
      true,
      "At depth 2 a breadcrumb back to the review drawer is shown",
    );

    // Pop ONE level: back to the review drawer, still open.
    await pressEscape(page);
    await waitForDrawerTitle(page, "Review Document");
    assertEqual(
      await getDrawerTitle(page),
      "Review Document",
      "closeTopDrawer pops only the preview, revealing the review drawer beneath",
    );

    // Pop the last level: stack empty.
    await pressEscape(page);
    await waitForDrawerClosed(page);
    assertEqual(
      await drawerIsOpen(page),
      false,
      "closeTopDrawer on the review drawer empties the stack",
    );

    // -------------------------------------------------------------------
    // Drawer 4: assign-checklist
    // -------------------------------------------------------------------
    await gotoTab(page, baseUrl, client.id, "checklist");
    await clickButtonByText(page, /Assign Checklist Template/);
    await waitForDrawerTitle(page, "Assign Checklist Template");
    assertEqual(
      await getDrawerTitle(page),
      "Assign Checklist Template",
      "Assign Checklist Template trigger opens the assign-checklist drawer",
    );
    await pressEscape(page);
    await waitForDrawerClosed(page);
    assertEqual(
      await drawerIsOpen(page),
      false,
      "Escape (closeTopDrawer) closes the assign-checklist drawer",
    );

    // -------------------------------------------------------------------
    // Drawer 5: payment-record
    // -------------------------------------------------------------------
    await gotoTab(page, baseUrl, client.id, "billing");
    await clickButtonByText(page, /^Pay$/);
    await waitForDrawerTitle(page, "Record Payment");
    assertEqual(
      await getDrawerTitle(page),
      "Record Payment",
      "Pay trigger opens the payment-record drawer",
    );
    await pressEscape(page);
    await waitForDrawerClosed(page);
    assertEqual(
      await drawerIsOpen(page),
      false,
      "Escape (closeTopDrawer) closes the payment-record drawer",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (devServer) await devServer.stop();
    // Cleanup in FK-safe order: billing/documents (via session/client cascade),
    // sessions, services, clients, users.
    try {
      if (createdSessionIds.length > 0) {
        await db.delete(sessionBilling).where(inArray(sessionBilling.sessionId, createdSessionIds));
      }
      if (createdClientIds.length > 0) {
        await db.delete(documents).where(inArray(documents.clientId, createdClientIds));
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

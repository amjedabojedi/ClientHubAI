/**
 * BROWSER-LEVEL test that the migrated client-detail slide-over drawers can
 * actually SUBMIT, not just open.
 *
 * Task #105 moved five staff dialogs on the client-detail page out of Radix
 * <Dialog>s and into the RecordDrawer slide-over system. Their bodies are now
 * PORTALED (createPortal) into a single shared host outlet. The sibling suite
 * test/client-detail-drawers-ui.test.ts proves each drawer OPENS with the right
 * title and CLOSES via closeTopDrawer — but it never exercises the write
 * actions. After the migration a drawer could open correctly yet fail to
 * persist (a stale closure over the wrong state, a portal body wired to a dead
 * handler, a mutation whose onSuccess never fires) — and staff would only find
 * out when their work silently vanished.
 *
 * This suite drives a real Chromium against a real dev server, logs in as an
 * admin, and for each migrated drawer WITH a write action it fills the form,
 * submits, waits for the mutation's HTTP request to return 2xx, AND confirms
 * the server-side effect by reading the row back from the database:
 *
 *   1. payment-record   — Billing "Pay" → Record Payment
 *                         → PUT /api/billing/:id/payment (200)
 *                         → session_billing.paymentStatus becomes "paid".
 *   2. document-review  — Documents "Review Now" → Approve
 *                         → PATCH /api/clients/:id/documents/:docId/review (200)
 *                         → documents.reviewStatus becomes "reviewed".
 *   3. assign-checklist — Checklists "Assign Checklist Template" → pick template
 *                         → POST /api/clients/:id/checklists (200)
 *                         → a client_checklists row exists for that template.
 *   4. upload-document  — Documents "Upload Document" → choose file + name
 *                         → POST /api/clients/:id/documents (201)
 *                         → a new documents row exists with that file name.
 *
 * Auth + server wiring mirror the sibling browser suites exactly (see
 * test/helpers/browser.ts and .agents/memory/browser-tests-puppeteer.md): a
 * real dev server on an ephemeral port, in-page /api/auth/login, and
 * localStorage.currentUser seeded for the SPA's useAuth.
 *
 * Run with: npx tsx test/client-detail-drawers-submit.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a dedicated admin, client, service, session, one pending
 *   billing record, one pending-review document, and one checklist template;
 *   all removed at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md).
 */

import type { Browser, Page, HTTPResponse } from "puppeteer";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
  sessionBilling,
  paymentTransactions,
  documents,
  checklistTemplates,
  clientChecklists,
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

function assertTrue(actual: boolean, message: string) {
  assertEqual(actual, true, message);
}

const SUFFIX = `cd-drawers-submit-${Date.now()}`;
const DRAWER = '[data-testid="record-drawer"]';
const TITLE = '[data-testid="record-drawer-title"]';

// Track seeded rows for teardown.
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdServiceIds: number[] = [];
const createdSessionIds: number[] = [];
const createdTemplateIds: number[] = [];

let seededDocId = 0;
const TEMPLATE_NAME = `Intake Checklist ${SUFFIX}`;
const UPLOAD_FILE_NAME = `Uploaded Report ${SUFFIX}`;

// A tiny on-disk PDF for the upload-document flow. PDF keeps the file upload
// (and any later preview) network-light and matches the input's accept list.
const tmpPdfPath = join(tmpdir(), `${SUFFIX}.pdf`);
const MINIMAL_PDF =
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n" +
  "trailer<</Root 1 0 R>>\n%%EOF\n";

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
  // button that opens the document-review drawer.
  const doc = await storage.createDocument({
    clientId: client.id,
    uploadedById: admin.id,
    fileName: `seeded-${SUFFIX}.pdf`,
    originalName: `seeded-${SUFFIX}.pdf`,
    fileSize: 2048,
    mimeType: "application/pdf",
    category: "uploaded",
    reviewStatus: "pending_review",
  } as any);
  seededDocId = doc.id;

  // One active checklist template so the Checklists tab's assign drawer renders
  // a template button to click.
  const [template] = await db
    .insert(checklistTemplates)
    .values({ name: TEMPLATE_NAME, isActive: true } as any)
    .returning();
  createdTemplateIds.push(template.id);

  return { admin, client };
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

// Click the first <button> whose visible text matches `pattern`, optionally
// scoped under `rootSelector`. Uses a trusted ElementHandle click (a synthetic
// element.click() inside page.evaluate is not enough for some handlers).
async function clickButtonByText(
  page: Page,
  pattern: RegExp,
  rootSelector?: string,
): Promise<void> {
  const root = rootSelector ?? "body";
  await page.waitForSelector(`${root} button`, { timeout: 30_000 });
  const handles = await page.$$(`${root} button`);
  for (const handle of handles) {
    const text = await handle.evaluate((el: Element) => (el.textContent || "").trim());
    if (pattern.test(text)) {
      await handle.click();
      return;
    }
  }
  throw new Error(`Could not find a button matching ${pattern} under ${root}`);
}

// Wait until the drawer is open AND its title equals `expected`.
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

async function waitForDrawerClosed(page: Page): Promise<void> {
  await page.waitForFunction(
    (sel: string) => !document.querySelector(sel),
    { timeout: 30_000 },
    DRAWER,
  );
}

// Build a waiter for the mutation's HTTP request BEFORE triggering it, so we
// never miss a fast response. Matches by URL substring + HTTP method.
function waitForApi(
  page: Page,
  predicate: (url: string, method: string) => boolean,
): Promise<HTTPResponse> {
  return page.waitForResponse(
    (res) => predicate(res.url(), res.request().method()),
    { timeout: 30_000 },
  );
}

async function gotoTab(page: Page, baseUrl: string, clientId: number, tab: string) {
  await page.goto(`${baseUrl}/clients/${clientId}?tab=${tab}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('[role="tablist"], main, body', { timeout: 30_000 });
}

// Type into an input by id, clearing any pre-filled value first.
async function typeInto(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value);
}

// ---------------------------------------------------------------------------
let browser: Browser;
let devServer: DevServer | null = null;

async function main() {
  writeFileSync(tmpPdfPath, MINIMAL_PDF);
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
    // Drawer 1: payment-record — fill amount, submit, expect "paid".
    // -------------------------------------------------------------------
    await gotoTab(page, baseUrl, client.id, "billing");
    await clickButtonByText(page, /^Pay$/);
    await waitForDrawerTitle(page, "Record Payment");

    await typeInto(page, "#payment-amount", "120.00");
    const paymentResp = waitForApi(
      page,
      (url, method) => method === "PUT" && /\/api\/billing\/\d+\/payment/.test(url),
    );
    await clickButtonByText(page, /^Record Payment$/, DRAWER);
    assertEqual((await paymentResp).status(), 200, "Record Payment returns HTTP 200");
    await waitForDrawerClosed(page);

    const billingRows = await db
      .select()
      .from(sessionBilling)
      .where(inArray(sessionBilling.sessionId, createdSessionIds));
    assertEqual(
      billingRows[0]?.paymentStatus,
      "paid",
      "Submitting the payment drawer marks the billing record paid",
    );

    // -------------------------------------------------------------------
    // Drawer 2: document-review — approve the seeded pending-review doc.
    // -------------------------------------------------------------------
    await gotoTab(page, baseUrl, client.id, "documents");
    await clickButtonByText(page, /Review Now/);
    await waitForDrawerTitle(page, "Review Document");

    const reviewResp = waitForApi(
      page,
      (url, method) =>
        method === "PATCH" && /\/api\/clients\/\d+\/documents\/\d+\/review/.test(url),
    );
    await clickButtonByText(page, /Approve/, DRAWER);
    assertEqual((await reviewResp).status(), 200, "Approve (review) returns HTTP 200");
    await waitForDrawerClosed(page);

    const reviewedDoc = await db
      .select()
      .from(documents)
      .where(eq(documents.id, seededDocId))
      .limit(1);
    assertEqual(
      reviewedDoc[0]?.reviewStatus,
      "reviewed",
      "Approving in the review drawer sets the document reviewStatus to reviewed",
    );

    // -------------------------------------------------------------------
    // Drawer 3: assign-checklist — pick the seeded template.
    // -------------------------------------------------------------------
    await gotoTab(page, baseUrl, client.id, "checklist");
    await clickButtonByText(page, /Assign Checklist Template/);
    await waitForDrawerTitle(page, "Assign Checklist Template");

    const checklistResp = waitForApi(
      page,
      (url, method) => method === "POST" && /\/api\/clients\/\d+\/checklists/.test(url),
    );
    await clickButtonByText(page, new RegExp(TEMPLATE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), DRAWER);
    assertEqual((await checklistResp).status(), 200, "Assign checklist returns HTTP 200");
    await waitForDrawerClosed(page);

    const assignedChecklists = await db
      .select()
      .from(clientChecklists)
      .where(inArray(clientChecklists.clientId, createdClientIds));
    // Coerce both sides: a serial id can come back as a string while the
    // referencing integer column comes back as a number.
    const templateIdSet = new Set(createdTemplateIds.map(Number));
    assertTrue(
      assignedChecklists.some((c) => templateIdSet.has(Number(c.templateId))),
      "Assigning a checklist template creates a client_checklists row",
    );

    // -------------------------------------------------------------------
    // Drawer 4: upload-document — choose file + name, submit.
    // -------------------------------------------------------------------
    await gotoTab(page, baseUrl, client.id, "documents");
    await clickButtonByText(page, /^Upload Document$/);
    await waitForDrawerTitle(page, "Upload Document");

    const fileInput = await page.$('#file-upload');
    if (!fileInput) throw new Error("Could not find the upload-document file input");
    await (fileInput as any).uploadFile(tmpPdfPath);
    await typeInto(page, "#document-name", UPLOAD_FILE_NAME);

    const uploadResp = waitForApi(
      page,
      (url, method) => method === "POST" && /\/api\/clients\/\d+\/documents$/.test(url),
    );
    await clickButtonByText(page, /^Upload Document$/, DRAWER);
    assertEqual((await uploadResp).status(), 201, "Upload Document returns HTTP 201");
    await waitForDrawerClosed(page);

    const clientDocs = await db
      .select()
      .from(documents)
      .where(inArray(documents.clientId, createdClientIds));
    assertTrue(
      clientDocs.some((d) => d.fileName === UPLOAD_FILE_NAME),
      "Submitting the upload drawer persists a new document row",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (devServer) await devServer.stop();
    try {
      unlinkSync(tmpPdfPath);
    } catch {}
    // Cleanup in FK-safe order. Deleting the client cascades its
    // client_checklists / items; documents and billing are removed explicitly.
    try {
      if (createdSessionIds.length > 0) {
        const billingRows = await db
          .select({ id: sessionBilling.id })
          .from(sessionBilling)
          .where(inArray(sessionBilling.sessionId, createdSessionIds));
        const billingIds = billingRows.map((b) => b.id);
        if (billingIds.length > 0) {
          await db
            .delete(paymentTransactions)
            .where(inArray(paymentTransactions.sessionBillingId, billingIds));
        }
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
      if (createdTemplateIds.length > 0) {
        await db.delete(checklistTemplates).where(inArray(checklistTemplates.id, createdTemplateIds));
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

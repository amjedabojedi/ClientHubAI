/**
 * BROWSER-LEVEL regression test for administrator recording cleanup.
 *
 * The server-level cleanup test protects authorization and transaction
 * semantics. This suite drives the actual unresolved-recordings review page
 * in Chromium so UI wiring cannot silently prevent an administrator from
 * reviewing, confirming, or completing the destructive action.
 *
 * It verifies:
 *   1. An administrator can open cleanup review for an unfinished attempt.
 *   2. The remove button stays disabled until the exact confirmation phrase is
 *      entered (including after an incorrect phrase).
 *   3. A stale review is rejected by the server, leaves the attempt visible,
 *      and shows the server's error in the dialog.
 *   4. A successful removal closes the review dialog and removes only the
 *      selected attempt from the report.
 *   5. Therapist, supervisor, and billing users see the restricted state without
 *      loading the unresolved recording report.
 *
 * Run with: npx tsx test/recording-retention-cleanup-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated rows and removes them in a finally block.
 * - Must run serially with the other app-level tests because browser suites
 *   share the development database.
 */

import type { Browser, Page } from "puppeteer";
import {
  startDevServer,
  launchBrowser,
  loginAs,
  type DevServer,
} from "./helpers/browser";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { ensureAuditEnumsAtStartup } from "../server/audit-enum-check";
import {
  auditLogs,
  clients,
  recordingRetentionDecisions,
  services,
  sessionTranscripts,
  sessions,
  users,
  RECORDING_RETENTION_CLEANUP_CONFIRMATION,
} from "../shared/schema";
import { and, eq, inArray } from "drizzle-orm";

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
  assert(
    actual === expected,
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

const SUFFIX = `recording-cleanup-ui-${Date.now()}`;

async function clickTestId(page: Page, testId: string): Promise<void> {
  const selector = `[data-testid="${testId}"]`;
  await page.waitForSelector(selector, { timeout: 30_000 });
  const clicked = await page.evaluate((sel: string) => {
    const element = document.querySelector(sel) as HTMLElement | null;
    if (!element) return false;
    element.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`Could not click ${selector}`);
}

async function isDisabled(page: Page, testId: string): Promise<boolean> {
  return page.$eval(
    `[data-testid="${testId}"]`,
    (element) => (element as HTMLButtonElement).disabled,
  );
}

async function typeCleanupConfirmation(page: Page, value: string): Promise<void> {
  const selector = '[data-testid="input-retention-cleanup-confirmation"]';
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.click(selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(value);
}

async function main() {
  let devServer: DevServer | null = null;
  let browser: Browser | null = null;
  let adminId: number | undefined;
  let therapistId: number | undefined;
  let supervisorId: number | undefined;
  let billingId: number | undefined;
  let clientId: number | undefined;
  let serviceId: number | undefined;
  let sessionId: number | undefined;
  const attemptIds: number[] = [];

  try {
    await ensureAuditEnumsAtStartup();

    const admin = await storage.createUser({
      username: `cleanup-ui-admin-${SUFFIX}`,
      password: "x",
      fullName: `Cleanup UI Admin ${SUFFIX}`,
      email: `cleanup-ui-admin-${SUFFIX}@example.test`,
      role: "administrator",
    } as any);
    adminId = admin.id;

    const therapist = await storage.createUser({
      username: `cleanup-ui-therapist-${SUFFIX}`,
      password: "x",
      fullName: `Cleanup UI Therapist ${SUFFIX}`,
      email: `cleanup-ui-therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    therapistId = therapist.id;

    const supervisor = await storage.createUser({
      username: `cleanup-ui-supervisor-${SUFFIX}`,
      password: "x",
      fullName: `Cleanup UI Supervisor ${SUFFIX}`,
      email: `cleanup-ui-supervisor-${SUFFIX}@example.test`,
      role: "supervisor",
    } as any);
    supervisorId = supervisor.id;

    const billing = await storage.createUser({
      username: `cleanup-ui-billing-${SUFFIX}`,
      password: "x",
      fullName: `Cleanup UI Billing ${SUFFIX}`,
      email: `cleanup-ui-billing-${SUFFIX}@example.test`,
      role: "billing",
    } as any);
    billingId = billing.id;

    const [client] = await db
      .insert(clients)
      .values({
        clientId: `T${Date.now()}`.slice(0, 20),
        fullName: `Cleanup UI Client ${SUFFIX}`,
        assignedTherapistId: admin.id,
      } as any)
      .returning();
    clientId = client.id;

    const [service] = await db
      .insert(services)
      .values({
        serviceCode: `CLEANUP-UI-${SUFFIX}`.slice(0, 50),
        serviceName: `Cleanup UI Service ${SUFFIX}`,
        duration: 60,
        baseRate: "100.00",
      })
      .returning();
    serviceId = service.id;

    const [session] = await db
      .insert(sessions)
      .values({
        clientId,
        therapistId: admin.id,
        serviceId,
        sessionDate: new Date("2026-04-12T10:00:00.000Z"),
        sessionType: "individual",
        status: "scheduled",
      })
      .returning();
    sessionId = session.id;

    async function createAttempt(label: string) {
      const [attempt] = await db
        .insert(sessionTranscripts)
        .values({
          sessionId,
          clientId,
          therapistId: admin.id,
          content: `Buffered transcript ${label}`,
          rawContent: `Raw buffered transcript ${label}`,
          durationSeconds: 15,
          chunkCount: 1,
          wordCount: 3,
          uploadId: `cleanup-ui-${label}-${SUFFIX}`,
          chunks: {
            "0": { text: `Buffered chunk ${label}`, durationSeconds: 15 },
          },
          status: "recording",
        } as any)
        .returning();
      attemptIds.push(attempt.id);
      return attempt;
    }

    function auditFor(attemptId: number) {
      return {
        userId: admin.id,
        username: admin.username,
        action: "recording_retention_decision_recorded" as const,
        result: "success" as const,
        resourceType: "session_transcript",
        resourceId: String(attemptId),
        clientId,
        ipAddress: "127.0.0.1",
        userAgent: "recording-retention-cleanup-ui.test",
        hipaaRelevant: true,
        riskLevel: "high" as const,
        details: JSON.stringify({ attemptId }),
        accessReason: "Recording cleanup UI regression test",
      };
    }

    async function createDecision(
      attemptId: number,
      decision: "cleanup_authorized" | "retain",
    ) {
      await storage.createRecordingRetentionDecisionWithAudit(
        {
          attemptId,
          sessionId,
          clientId,
          decision,
          rationale:
            decision === "cleanup_authorized"
              ? "Approved cleanup for UI regression test"
              : "Retain after stale cleanup review",
          decidedById: admin.id,
          decidedByName: admin.username,
        },
        auditFor(attemptId),
      );
    }

    // The first attempt will become stale after the report loads and exercise
    // the failed-cleanup path. The second is the selected successful cleanup.
    const rejectedAttempt = await createAttempt("rejected");
    const removedAttempt = await createAttempt("removed");
    await createDecision(rejectedAttempt.id, "cleanup_authorized");
    await createDecision(removedAttempt.id, "cleanup_authorized");

    devServer = await startDevServer();
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(devServer.baseUrl, { waitUntil: "domcontentloaded" });
    const loginStatus = await loginAs(page, {
      username: admin.username,
      password: "x",
    });
    assertEqual(loginStatus, 200, "Administrator logs in via /api/auth/login");

    await page.goto(`${devServer.baseUrl}/unresolved-recordings`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(
      `[data-testid="row-unresolved-recording-${rejectedAttempt.id}"]`,
      { timeout: 30_000 },
    );
    await page.waitForSelector(
      `[data-testid="row-unresolved-recording-${removedAttempt.id}"]`,
      { timeout: 30_000 },
    );
    assert(
      (await page.$(
        `[data-testid="button-review-retention-cleanup-${rejectedAttempt.id}"]`,
      )) !== null,
      "Administrator sees the cleanup review control for an unfinished attempt",
    );

    await clickTestId(
      page,
      `button-review-retention-cleanup-${rejectedAttempt.id}`,
    );
    await page.waitForSelector(
      '[data-testid="input-retention-cleanup-confirmation"]',
      { timeout: 30_000 },
    );
    assert(
      (await page.$eval(
        "body",
        (element) => element.textContent || "",
      )).includes(RECORDING_RETENTION_CLEANUP_CONFIRMATION),
      "Cleanup review displays the exact confirmation phrase",
    );
    assertEqual(
      await isDisabled(page, "button-confirm-retention-cleanup"),
      true,
      "Removal starts disabled before confirmation",
    );

    await typeCleanupConfirmation(page, "DELETE RECORDING");
    assertEqual(
      await isDisabled(page, "button-confirm-retention-cleanup"),
      true,
      "An incomplete confirmation phrase keeps removal disabled",
    );
    await typeCleanupConfirmation(page, RECORDING_RETENTION_CLEANUP_CONFIRMATION);
    assertEqual(
      await isDisabled(page, "button-confirm-retention-cleanup"),
      false,
      "The exact confirmation phrase enables removal",
    );

    // Make the loaded review stale. The server must reject this cleanup even
    // though the button was enabled from the earlier authorized decision.
    await createDecision(rejectedAttempt.id, "retain");
    const [rejectedResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              `/api/admin/session-transcripts/recovery/${rejectedAttempt.id}/cleanup`,
            ) && response.request().method() === "POST",
        { timeout: 30_000 },
      ),
      clickTestId(page, "button-confirm-retention-cleanup"),
    ]);
    assertEqual(
      rejectedResponse.status(),
      409,
      "A stale cleanup review receives the server rejection",
    );
    await page.waitForFunction(
      () =>
        document.body.innerText.includes(
          "The latest retention decision does not authorize cleanup",
        ),
      { timeout: 10_000 },
    );
    assert(
      (await page.$eval("body", (element) => element.innerText)).includes(
        "The latest retention decision does not authorize cleanup",
      ),
      "The failed cleanup displays the server error",
    );
    assert(
      (await page.$(
        `[data-testid="row-unresolved-recording-${rejectedAttempt.id}"]`,
      )) !== null,
      "The failed cleanup leaves its attempt visible",
    );

    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[data-testid="input-retention-cleanup-confirmation"]',
        ),
      { timeout: 10_000 },
    );

    await clickTestId(
      page,
      `button-review-retention-cleanup-${removedAttempt.id}`,
    );
    await typeCleanupConfirmation(page, RECORDING_RETENTION_CLEANUP_CONFIRMATION);
    const [removedResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              `/api/admin/session-transcripts/recovery/${removedAttempt.id}/cleanup`,
            ) && response.request().method() === "POST",
        { timeout: 30_000 },
      ),
      clickTestId(page, "button-confirm-retention-cleanup"),
    ]);
    assertEqual(
      removedResponse.status(),
      200,
      "An administrator can complete cleanup from the review screen",
    );
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[data-testid="input-retention-cleanup-confirmation"]',
        ),
      { timeout: 30_000 },
    );
    await page.waitForFunction(
      (id: number) =>
        !document.querySelector(`[data-testid="row-unresolved-recording-${id}"]`),
      { timeout: 30_000 },
      removedAttempt.id,
    );
    assert(
      (await page.$(
        `[data-testid="row-unresolved-recording-${removedAttempt.id}"]`,
      )) === null,
      "Successful cleanup removes only the selected attempt from the list",
    );
    assert(
      (await page.$(
        `[data-testid="row-unresolved-recording-${rejectedAttempt.id}"]`,
      )) !== null,
      "The other unfinished attempt remains in the list after cleanup",
    );

    const recoveryReportRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/admin/session-transcripts/recovery")) {
        recoveryReportRequests.push(request.url());
      }
    });

    for (const nonAdministrator of [
      { label: "Therapist", user: therapist },
      { label: "Supervisor", user: supervisor },
      { label: "Billing", user: billing },
    ]) {
      recoveryReportRequests.length = 0;
      await page.goto(devServer.baseUrl, { waitUntil: "domcontentloaded" });
      const nonAdministratorLoginStatus = await loginAs(page, {
        username: nonAdministrator.user.username,
        password: "x",
      });
      assertEqual(
        nonAdministratorLoginStatus,
        200,
        `${nonAdministrator.label} user logs in via /api/auth/login`,
      );

      await page.goto(`${devServer.baseUrl}/unresolved-recordings`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(
        () =>
          document.body.innerText.includes("Access Restricted") &&
          document.body.innerText.includes(
            "Unresolved recording reports are restricted to administrators only.",
          ),
        { timeout: 30_000 },
      );
      const pageText = await page.$eval(
        "body",
        (element) => element.innerText,
      );
      assert(
        pageText.includes("Access Restricted") &&
          pageText.includes(
            "Unresolved recording reports are restricted to administrators only.",
          ),
        `${nonAdministrator.label} sees the restricted-access state`,
      );
      assert(
        !pageText.includes("Unresolved Recording Attempts") &&
          (await page.$('[data-testid="button-refresh-unresolved-recordings"]')) ===
            null &&
          (await page.$('[data-testid^="button-review-retention-cleanup-"]')) ===
            null,
        `${nonAdministrator.label} cannot reach unresolved recording review controls`,
      );
      assertEqual(
        recoveryReportRequests.length,
        0,
        `${nonAdministrator.label} does not request the unresolved recording report`,
      );
    }
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (devServer) await devServer.stop();

    try {
      if (attemptIds.length > 0) {
        await db
          .delete(recordingRetentionDecisions)
          .where(inArray(recordingRetentionDecisions.attemptId, attemptIds));
        await db
          .delete(sessionTranscripts)
          .where(inArray(sessionTranscripts.id, attemptIds));
      }
      if (clientId !== undefined) {
        await db
          .delete(recordingRetentionDecisions)
          .where(eq(recordingRetentionDecisions.clientId, clientId));
        await db
          .delete(sessionTranscripts)
          .where(eq(sessionTranscripts.clientId, clientId));
      }
      if (adminId !== undefined || clientId !== undefined) {
        const conditions = [];
        if (adminId !== undefined) conditions.push(eq(auditLogs.userId, adminId));
        if (clientId !== undefined) conditions.push(eq(auditLogs.clientId, clientId));
        if (conditions.length > 0) {
          await db.delete(auditLogs).where(and(...conditions));
        }
      }
      if (sessionId !== undefined) {
        await db.delete(sessions).where(eq(sessions.id, sessionId));
      }
      if (clientId !== undefined) {
        await db.delete(clients).where(eq(clients.id, clientId));
      }
      if (serviceId !== undefined) {
        await db.delete(services).where(eq(services.id, serviceId));
      }
      const userIds = [adminId, therapistId, supervisorId, billingId].filter(
        (id): id is number => id !== undefined,
      );
      if (userIds.length > 0) {
        await db.delete(users).where(inArray(users.id, userIds));
      }
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
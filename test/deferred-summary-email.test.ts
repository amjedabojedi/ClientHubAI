/**
 * Automated tests for the deferred quiet-hours catch-up summary.
 *
 * Quiet hours / weekend muting normally SUPPRESSES the outbound email "ping".
 * With the per-user "defer to summary" setting on, a suppressed email must be
 * QUEUED instead of dropped, and a scheduled job sends ONE consolidated catch-up
 * email per user once they are no longer muted.
 *
 * This suite locks in:
 *   1. ENQUEUE: a suppressed email is queued (pending row) when defer-to-summary
 *      is on, and NOT sent immediately.
 *   2. SUPPRESS (default): with defer off, a suppressed email is dropped — no
 *      queue row, no send.
 *   3. FLUSH GATING: while the user is still muted, the summary job leaves the
 *      queued rows pending and sends nothing.
 *   4. CONSOLIDATION: once unmuted, the job sends exactly ONE email containing
 *      all queued items, and marks the rows 'sent'.
 *   5. IDEMPOTENCY: a second run does not re-send (no duplicate catch-up).
 *   6. CRASH SAFETY: a stale 'processing' row (crash after the provider accepted
 *      but before the rows were marked 'sent') is NEVER auto-re-sent.
 *
 * The SparkPost provider is stubbed at `SparkPost.prototype.post` so no real
 * email is sent. Run with: npx tsx test/deferred-summary-email.test.ts
 *
 * NOTE: DB-backed and serial-only (see .agents/memory/privacy-test-concurrency.md);
 * it is chained into the `test-privacy` validation.
 */

process.env.SPARKPOST_API_KEY = process.env.SPARKPOST_API_KEY || "test-sparkpost-key";
process.env.EMAIL_FROM = process.env.EMAIL_FROM || "schedule@example.test";

import SparkPost from "sparkpost";
import { db } from "../server/db";
import {
  users,
  notificationPreferences,
  deferredNotificationEmails,
} from "../shared/schema";
import { storage } from "../server/storage";
import { notificationService } from "../server/notification-service";
import { and, eq, inArray } from "drizzle-orm";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

const PRACTICE_TZ = "America/New_York";
const GLOBAL_TRIGGER = "__global__";

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

const SUFFIX = `dse-summary-${process.pid}-${Date.now()}`;
const createdUserIds: number[] = [];

// ---------------------------------------------------------------------------
// SparkPost stub — capture the text body of each send per recipient email.
// ---------------------------------------------------------------------------
const sendsByEmail = new Map<string, string[]>();
const failEmails = new Set<string>();
const originalPost = (SparkPost.prototype as any).post;

function installSparkPostStub() {
  (SparkPost.prototype as any).post = async function (options: any) {
    const recips = options?.json?.recipients ?? [];
    const text = options?.json?.content?.text ?? "";
    const emails = recips.map((r: any) =>
      typeof r?.address === "string" ? r.address : r?.address?.email,
    );
    for (const email of emails) {
      const list = sendsByEmail.get(email) ?? [];
      list.push(text);
      sendsByEmail.set(email, list);
    }
    if (emails.some((e: string) => failEmails.has(e))) {
      throw new Error("Simulated SparkPost transmission failure");
    }
    return { results: { id: `mock-${Date.now()}` } };
  };
}

function restoreSparkPostStub() {
  (SparkPost.prototype as any).post = originalPost;
}

function sendsFor(email: string): string[] {
  return sendsByEmail.get(email) ?? [];
}

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

function fmtTime(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

// A quiet window guaranteed to contain the real "now" in Eastern time.
function windowCoveringNow(): { start: string; end: string } {
  const easternNow = toZonedTime(new Date(), PRACTICE_TZ);
  const mins = easternNow.getHours() * 60 + easternNow.getMinutes();
  return { start: fmtTime(mins - 60), end: fmtTime(mins + 60) };
}

async function pendingRows(userId: number) {
  return await db
    .select()
    .from(deferredNotificationEmails)
    .where(eq(deferredNotificationEmails.userId, userId));
}

const minimalTrigger = (eventType: string) =>
  ({ eventType, name: "Test trigger", priority: "normal" }) as any;
const minimalTemplate = (subject: string, body: string) =>
  ({ subject, bodyTemplate: body }) as any;

// ---------------------------------------------------------------------------
async function main() {
  installSparkPostStub();

  try {
    // -------------------------------------------------------------------
    // Test 1: defer-to-summary ON -> a suppressed email is QUEUED, not sent.
    // -------------------------------------------------------------------
    {
      const t = await makeTherapist("enqueue");
      const win = windowCoveringNow();
      await storage.setUserNotificationPreference(t.id, GLOBAL_TRIGGER, {
        quietHoursStart: win.start,
        quietHoursEnd: win.end,
        weekendsEnabled: true,
        quietHoursDeferToSummary: true,
      } as any);

      await (notificationService as any).sendEmailNotifications(
        [t],
        minimalTrigger("session_scheduled"),
        minimalTemplate("New session for {{name}}", "Details for {{name}}"),
        { name: "Client" },
      );

      const rows = await pendingRows(t.id);
      assertEqual(sendsFor(t.email).length, 0, "Suppressed email is NOT sent immediately");
      assertEqual(rows.length, 1, "Suppressed email is queued as one pending row");
      assertEqual(rows[0]?.status, "pending", "Queued row status is 'pending'");
      assert(
        (rows[0]?.subject ?? "").includes("New session for Client"),
        "Queued row stores the rendered subject",
      );
    }

    // -------------------------------------------------------------------
    // Test 2: defer-to-summary OFF (default) -> suppressed email is DROPPED.
    // -------------------------------------------------------------------
    {
      const t = await makeTherapist("suppress");
      const win = windowCoveringNow();
      await storage.setUserNotificationPreference(t.id, GLOBAL_TRIGGER, {
        quietHoursStart: win.start,
        quietHoursEnd: win.end,
        weekendsEnabled: true,
        quietHoursDeferToSummary: false,
      } as any);

      await (notificationService as any).sendEmailNotifications(
        [t],
        minimalTrigger("session_scheduled"),
        minimalTemplate("Subject", "Body"),
        {},
      );

      const rows = await pendingRows(t.id);
      assertEqual(sendsFor(t.email).length, 0, "Suppress mode: email is not sent");
      assertEqual(rows.length, 0, "Suppress mode: nothing is queued (dropped)");
    }

    // -------------------------------------------------------------------
    // Tests 3-5: flush gating, consolidation, idempotency.
    // Uses a fixed quiet window + a controlled "now" so we can move into and
    // out of the window deterministically.
    // -------------------------------------------------------------------
    {
      const t = await makeTherapist("flush");
      // Fixed narrow window 22:00 -> 23:00 Eastern.
      await storage.setUserNotificationPreference(t.id, GLOBAL_TRIGGER, {
        quietHoursStart: "22:00:00",
        quietHoursEnd: "23:00:00",
        weekendsEnabled: true,
        quietHoursDeferToSummary: true,
      } as any);

      // Seed two queued items directly (simulating two suppressed events).
      await storage.enqueueDeferredNotificationEmail({
        userId: t.id,
        triggerType: "session_scheduled",
        subject: "Session with A.B.",
        body: "Your 9am session was scheduled.",
        reason: "quiet hours",
        status: "pending",
        attempts: 0,
      } as any);
      await storage.enqueueDeferredNotificationEmail({
        userId: t.id,
        triggerType: "task_assigned",
        subject: "New task",
        body: "A task was assigned to you.",
        reason: "quiet hours",
        status: "pending",
        attempts: 0,
      } as any);

      // A weekday date so weekend muting is irrelevant (weekendsEnabled=true).
      const DATE = "2050-01-04"; // Tuesday
      const insideWindow = fromZonedTime(`${DATE}T22:30:00`, PRACTICE_TZ);
      const outsideWindow = fromZonedTime(`${DATE}T10:00:00`, PRACTICE_TZ);

      // Test 3: still muted -> nothing sent, rows stay pending.
      const r1 = await notificationService.processDeferredSummaryEmails(insideWindow);
      assertEqual(sendsFor(t.email).length, 0, "While muted: no catch-up is sent");
      assertEqual(r1.skipped >= 1, true, "While muted: the user is skipped");
      const stillPending = await pendingRows(t.id);
      assertEqual(
        stillPending.every((r) => r.status === "pending"),
        true,
        "While muted: queued rows remain 'pending'",
      );

      // Test 4: unmuted -> exactly one consolidated email; rows -> 'sent'.
      const r2 = await notificationService.processDeferredSummaryEmails(outsideWindow);
      const sent = sendsFor(t.email);
      assertEqual(sent.length, 1, "Unmuted: exactly ONE consolidated email is sent");
      assert(
        sent[0].includes("Session with A.B.") && sent[0].includes("New task"),
        "Consolidated email contains BOTH queued items",
      );
      // The global job may also flush other unmuted users with queued rows
      // (e.g. the enqueue user from Test 1), so assert >= 1 here and rely on the
      // per-recipient check above for the exactly-one-consolidated guarantee.
      assert(r2.sent >= 1, "processDeferredSummaryEmails reports at least one send");
      const afterFlush = await pendingRows(t.id);
      assertEqual(
        afterFlush.every((r) => r.status === "sent"),
        true,
        "After flush: all queued rows are marked 'sent'",
      );

      // Test 5: idempotency — a second unmuted run sends nothing more.
      await notificationService.processDeferredSummaryEmails(outsideWindow);
      assertEqual(
        sendsFor(t.email).length,
        1,
        "Second run does NOT re-send (no duplicate catch-up)",
      );
    }

    // -------------------------------------------------------------------
    // Test 6: a stale 'processing' row is NEVER auto-re-sent (at-most-once).
    // -------------------------------------------------------------------
    {
      const t = await makeTherapist("crash");
      await storage.setUserNotificationPreference(t.id, GLOBAL_TRIGGER, {
        quietHoursStart: "22:00:00",
        quietHoursEnd: "23:00:00",
        weekendsEnabled: true,
        quietHoursDeferToSummary: true,
      } as any);

      // Simulate a crash mid-send: row claimed ('processing') but never marked.
      await db.insert(deferredNotificationEmails).values({
        userId: t.id,
        triggerType: "session_scheduled",
        subject: "Half-sent",
        body: "body",
        reason: "quiet hours",
        status: "processing",
        attempts: 1,
      } as any);

      const outsideWindow = fromZonedTime("2050-01-04T10:00:00", PRACTICE_TZ);
      await notificationService.processDeferredSummaryEmails(outsideWindow);

      const rows = await pendingRows(t.id);
      assertEqual(sendsFor(t.email).length, 0, "Stale 'processing' row is NEVER re-sent");
      assertEqual(
        rows[0]?.status,
        "processing",
        "Stale 'processing' row is left in place for manual recovery",
      );
    }
  } finally {
    restoreSparkPostStub();
    try {
      if (createdUserIds.length > 0) {
        // deferred_notification_emails + notification_preferences cascade on
        // user delete, so removing the users cleans everything up.
        await db
          .delete(deferredNotificationEmails)
          .where(inArray(deferredNotificationEmails.userId, createdUserIds));
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

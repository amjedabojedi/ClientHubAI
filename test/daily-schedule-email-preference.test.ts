/**
 * Automated Tests for the Daily Schedule Email OPT-OUT preference.
 *
 * The daily digest opt-out is self-service: a therapist can disable the
 * `daily_schedule_email` notification by email. THIS suite proves the server
 * actually honors that preference during the daily send loop
 * (`notificationService.processDailyScheduleEmails`) so a regression can't
 * silently email a therapist who opted out (a trust/privacy issue).
 *
 * The gating lives in `isDailyDigestEmailEnabled` and mirrors the rest of the
 * notification system: default ON when no preference row exists, otherwise
 * honor an explicit `enableEmail` flag / `email` delivery method.
 *
 * Cases covered:
 *   1. DISABLED  — a notificationPreferences row for `daily_schedule_email`
 *      with email off ⇒ the therapist is SKIPPED (no email sent). The
 *      idempotency row is recorded 'sent' (the preference was honored; nothing
 *      more to do today) but NO provider call is made.
 *   2. DEFAULT   — no preference row at all ⇒ the therapist IS emailed.
 *   3. ENABLED   — an explicit row with email enabled ⇒ the therapist IS
 *      emailed.
 *
 * The SparkPost provider is stubbed at `SparkPost.prototype.post` (the single
 * method `transmissions.send` funnels through), so no real email is sent and no
 * cost is incurred. Stubbing per-recipient lets us isolate OUR test therapists
 * from any other therapists that happen to exist in the shared dev DB.
 *
 * Run with: npx tsx test/daily-schedule-email-preference.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named therapist users and removes them
 *   (and every daily_schedule_emails / notification_preferences row created on
 *   the test dates / for the test users) at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md); it is chained into the
 *   `test-privacy` validation.
 */

// Provider + sender config must be present so processDailyScheduleEmails does
// real work; the actual network call is stubbed below, so the values are fake.
process.env.SPARKPOST_API_KEY = process.env.SPARKPOST_API_KEY || "test-sparkpost-key";
process.env.EMAIL_FROM = process.env.EMAIL_FROM || "schedule@example.test";

import SparkPost from "sparkpost";
import { db } from "../server/db";
import { users, dailyScheduleEmails, notificationPreferences } from "../shared/schema";
import { storage } from "../server/storage";
import { notificationService } from "../server/notification-service";
import { eq, inArray } from "drizzle-orm";

// Must match DAILY_SCHEDULE_EMAIL_TRIGGER in server/notification-service.ts.
const DAILY_SCHEDULE_EMAIL_TRIGGER = "daily_schedule_email";

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

const SUFFIX = `dsepref-${Date.now()}`;
const createdUserIds: number[] = [];
const testDates: string[] = [];

// ---------------------------------------------------------------------------
// SparkPost stub — count send() calls per recipient email.
// ---------------------------------------------------------------------------
const postCallsByEmail = new Map<string, number>();
const originalPost = (SparkPost.prototype as any).post;

function recipientEmails(options: any): string[] {
  const recips = options?.json?.recipients ?? [];
  return recips.map((r: any) =>
    typeof r?.address === "string" ? r.address : r?.address?.email,
  );
}

function installSparkPostStub() {
  (SparkPost.prototype as any).post = async function (options: any) {
    const emails = recipientEmails(options);
    for (const email of emails) {
      postCallsByEmail.set(email, (postCallsByEmail.get(email) ?? 0) + 1);
    }
    return { results: { id: `mock-${Date.now()}` } };
  };
}

function restoreSparkPostStub() {
  (SparkPost.prototype as any).post = originalPost;
}

function callsFor(email: string): number {
  return postCallsByEmail.get(email) ?? 0;
}

// ---------------------------------------------------------------------------
// Seed helpers
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

// Per-process-unique, far-future Eastern dates. These must be unique not just
// vs. real data but vs. any OTHER concurrent instance of this suite (the
// workflow and a validation trigger can run it twice at once — see
// .agents/memory/privacy-test-concurrency.md). A random offset across a
// ~130-year future window makes cross-run date collisions effectively
// impossible, so one run's cleanup-by-date can never delete another run's rows.
const PROC_DATE_OFFSET =
  (process.pid * 31 + Math.floor(Math.random() * 50000)) % 50000;
let dateCounter = 0;
function nextTestDate(): string {
  const base = new Date(Date.UTC(2050, 0, 1));
  base.setUTCDate(base.getUTCDate() + PROC_DATE_OFFSET + dateCounter++);
  const d = base.toISOString().slice(0, 10);
  testDates.push(d);
  return d;
}

// ---------------------------------------------------------------------------
async function main() {
  installSparkPostStub();

  try {
    // -------------------------------------------------------------------
    // Test 1: an explicit DISABLED preference is honored — NOT emailed.
    // -------------------------------------------------------------------
    {
      const t = await makeTherapist("optout-therapist");
      const date = nextTestDate();

      // Self-service opt-out: a row for this digest with email turned off and
      // no 'email' delivery method.
      await db.insert(notificationPreferences).values({
        userId: t.id,
        triggerType: DAILY_SCHEDULE_EMAIL_TRIGGER,
        deliveryMethods: JSON.stringify(["in_app"]),
        enableInApp: true,
        enableEmail: false,
        enableSms: false,
      } as any);

      await notificationService.processDailyScheduleEmails(date);

      assertEqual(
        callsFor(t.email),
        0,
        "Therapist who opted out (email disabled) is NOT emailed",
      );
    }

    // -------------------------------------------------------------------
    // Test 2: DEFAULT (no preference row) — IS emailed.
    // -------------------------------------------------------------------
    {
      const t = await makeTherapist("default-therapist");
      const date = nextTestDate();

      // No notificationPreferences row at all → default ON.
      await notificationService.processDailyScheduleEmails(date);

      assertEqual(
        callsFor(t.email),
        1,
        "Therapist with no preference row (default) IS emailed",
      );
    }

    // -------------------------------------------------------------------
    // Test 3: an explicit ENABLED preference — IS emailed.
    // -------------------------------------------------------------------
    {
      const t = await makeTherapist("optin-therapist");
      const date = nextTestDate();

      await db.insert(notificationPreferences).values({
        userId: t.id,
        triggerType: DAILY_SCHEDULE_EMAIL_TRIGGER,
        deliveryMethods: JSON.stringify(["in_app", "email"]),
        enableInApp: true,
        enableEmail: true,
        enableSms: false,
      } as any);

      await notificationService.processDailyScheduleEmails(date);

      assertEqual(
        callsFor(t.email),
        1,
        "Therapist with email explicitly enabled IS emailed",
      );
    }
  } finally {
    restoreSparkPostStub();
    // Cleanup: remove every daily_schedule_emails row on our test dates, our
    // notification_preferences rows, then our users.
    try {
      if (testDates.length > 0) {
        await db
          .delete(dailyScheduleEmails)
          .where(inArray(dailyScheduleEmails.sendDate, testDates));
      }
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

/**
 * Automated Tests for account-wide QUIET HOURS + WEEKEND MUTING email suppression.
 *
 * Task #47 added account-wide quiet hours (a daily window) and weekend muting
 * that suppress OUTBOUND EMAIL notifications for staff accounts. The settings
 * live on a single reserved notificationPreferences row per user keyed by
 * triggerType "__global__" (see .agents/memory/quiet-hours-global-prefs.md).
 *
 * This suite proves the suppression actually fires so a regression can't either
 * (a) silently send after-hours/weekend pings, or (b) DROP emails when it
 * shouldn't. It also proves the in-app record is still created during
 * suppression (no data loss) and that clients are NEVER gated.
 *
 * Two layers of coverage:
 *
 *   FULL PIPELINE (processEvent → createNotificationsFromTrigger →
 *   sendEmailNotifications), with the SparkPost provider stubbed:
 *     1. Quiet window covering "now"  ⇒ staff email SUPPRESSED, but the in-app
 *        notification row IS still created (no data loss).
 *     2. Same suppression window      ⇒ the CLIENT recipient IS still emailed
 *        (clients have no global row and must get transactional mail).
 *     3. Quiet window NOT covering now ⇒ staff email IS sent (no over-blocking).
 *
 *   GATING UNIT (isDeliverySuppressedByQuietHours with an injected `now`, so the
 *   weekend/clock cases are deterministic regardless of when the suite runs):
 *     4. weekendsEnabled=false ⇒ suppressed on Sat AND Sun, delivered on a weekday.
 *     5. weekendsEnabled=true  ⇒ NOT suppressed even on a Saturday.
 *     6. Midnight-wrapping quiet window (22:00→08:00) ⇒ suppressed at 23:00 ET
 *        and 02:00 ET, delivered at 12:00 ET.
 *     7. No global row at all   ⇒ never suppressed (default deliver).
 *
 * Run with: npx tsx test/quiet-hours-suppression.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated, uniquely-named staff users + a client and
 *   removes everything it created at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md); it is chained into the
 *   `test-privacy` validation. Uniquely-named/unique-keyed rows keep it robust
 *   to a concurrent twin.
 */

// Provider + sender config must be present so sendEmailNotifications does real
// work; the actual network call is stubbed below, so the values are fake.
process.env.SPARKPOST_API_KEY = process.env.SPARKPOST_API_KEY || "test-sparkpost-key";
process.env.EMAIL_FROM = process.env.EMAIL_FROM || "alerts@example.test";

import SparkPost from "sparkpost";
import { db } from "../server/db";
import {
  users,
  clients,
  notifications,
  notificationPreferences,
  notificationTriggers,
  notificationTemplates,
} from "../shared/schema";
import { storage } from "../server/storage";
import { notificationService } from "../server/notification-service";
import { eq, inArray, and } from "drizzle-orm";
import { toZonedTime } from "date-fns-tz";

// Must match the constants in server/notification-service.ts.
const GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER = "__global__";
const PRACTICE_TZ = "America/New_York";

// Reach the private gating method for the deterministic, clock-injected cases.
const svc = notificationService as any;

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

const SUFFIX = `qh-${process.pid}-${Date.now()}`;
const createdUserIds: number[] = [];
const createdClientIds: number[] = [];
const createdTriggerIds: number[] = [];
const createdTemplateIds: number[] = [];
const eventTypes: string[] = [];

// ---------------------------------------------------------------------------
// SparkPost stub — count send() calls per recipient email. transmissions.send
// funnels through SparkPost.prototype.post, so stubbing post intercepts all
// sends without any network call (and without cost).
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
    for (const email of recipientEmails(options)) {
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
// Time helpers — build a 'HH:MM:SS' string from minutes-since-midnight (ET).
// ---------------------------------------------------------------------------
function minutesToTime(total: number): string {
  const m = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

// Current minutes-since-midnight in the practice timezone.
function nowEtMinutes(): number {
  const z = toZonedTime(new Date(), PRACTICE_TZ);
  return z.getHours() * 60 + z.getMinutes();
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function makeStaff(label: string) {
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

// Insert a client directly (with a unique business clientId) to avoid the
// CL-<year>-<MAX+1> create-race that affects storage.createClient under
// concurrency (see privacy-test-concurrency memory).
async function makeClient(label: string) {
  const unique = `${process.pid}${Date.now() % 100000}`.slice(-13);
  const [client] = await db
    .insert(clients)
    .values({
      clientId: `CL-${unique}`.slice(0, 20),
      fullName: `${label} ${SUFFIX}`,
      email: `${label}-${SUFFIX}@example.test`,
      emailNotifications: true,
      status: "active",
    } as any)
    .returning();
  createdClientIds.push(client.id);
  return client;
}

// Create a one-off trigger + template for a fresh, unique event type so our
// in-app/email lookups never collide with real triggers or a concurrent twin.
async function makeTrigger(label: string, recipientRules: object) {
  const eventType = `qh_test_${label}_${SUFFIX}`.slice(0, 50);
  eventTypes.push(eventType);

  const [template] = await db
    .insert(notificationTemplates)
    .values({
      name: `tmpl-${label}-${SUFFIX}`.slice(0, 100),
      type: eventType,
      subject: "Test alert",
      bodyTemplate: "You have a test alert.",
    } as any)
    .returning();
  createdTemplateIds.push(template.id);

  const [trigger] = await db
    .insert(notificationTriggers)
    .values({
      name: `trig-${label}-${SUFFIX}`.slice(0, 100),
      eventType,
      entityType: "session",
      conditionRules: "{}",
      recipientRules: JSON.stringify(recipientRules),
      templateId: template.id,
      isScheduled: false,
      isActive: true,
    } as any)
    .returning();
  createdTriggerIds.push(trigger.id);

  return { trigger, eventType };
}

// Upsert the reserved "__global__" delivery-settings row for a user.
async function setGlobalPref(
  userId: number,
  fields: {
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    weekendsEnabled?: boolean;
  },
) {
  await db
    .delete(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(
          notificationPreferences.triggerType,
          GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER,
        ),
      ),
    );
  await db.insert(notificationPreferences).values({
    userId,
    triggerType: GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER,
    quietHoursStart: fields.quietHoursStart ?? null,
    quietHoursEnd: fields.quietHoursEnd ?? null,
    weekendsEnabled: fields.weekendsEnabled ?? true,
  } as any);
}

async function inAppCount(userId: number, type: string): Promise<number> {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));
  return rows.length;
}

// A weekday/weekend Date at noon ET, expressed as the equivalent UTC instant so
// toZonedTime(...) inside the service maps it back to the intended ET clock.
// June 2026: 6th=Sat, 7th=Sun, 8th=Mon. Noon ET in summer (EDT) = 16:00 UTC.
const SATURDAY_NOON_ET = new Date("2026-06-06T16:00:00.000Z");
const SUNDAY_NOON_ET = new Date("2026-06-07T16:00:00.000Z");
const MONDAY_NOON_ET = new Date("2026-06-08T16:00:00.000Z");
// Two instants inside a 22:00→08:00 wrapping window (EDT = UTC-4). weekendsEnabled
// is true for these cases, so the weekday is irrelevant — only the clock matters.
const WRAP_2300_ET = new Date("2026-06-08T03:00:00.000Z"); // 23:00 ET
const WRAP_0200_ET = new Date("2026-06-08T06:00:00.000Z"); // 02:00 ET

// ---------------------------------------------------------------------------
async function main() {
  installSparkPostStub();

  try {
    // ===================================================================
    // FULL PIPELINE — quiet window covering "now"
    // ===================================================================
    {
      const staff = await makeStaff("qh-staff");
      const client = await makeClient("qh-client");
      const { eventType } = await makeTrigger("window", {
        assignedTherapist: true,
        sessionClient: true,
      });

      // A ±2h window around the current ET clock guarantees "now" is inside it.
      // weekendsEnabled true so weekend muting is irrelevant to this case.
      const n = nowEtMinutes();
      await setGlobalPref(staff.id, {
        quietHoursStart: minutesToTime(n - 120),
        quietHoursEnd: minutesToTime(n + 120),
        weekendsEnabled: true,
      });

      const before = await inAppCount(staff.id, eventType);

      await notificationService.processEvent(eventType, {
        id: 999000 + (process.pid % 1000),
        therapistId: staff.id,
        clientId: client.id,
      });

      // 1. Staff EMAIL is suppressed during the quiet window.
      assertEqual(
        callsFor(staff.email),
        0,
        "Staff email is SUPPRESSED during the quiet-hours window",
      );

      // 2. The in-app notification row IS still created (no data loss).
      const after = await inAppCount(staff.id, eventType);
      assertEqual(
        after - before,
        1,
        "In-app notification IS still created while email is suppressed",
      );

      // 3. The CLIENT is never gated — transactional email still goes out.
      assertEqual(
        callsFor(client.email!),
        1,
        "Client recipient IS still emailed during the staff quiet window",
      );
    }

    // ===================================================================
    // FULL PIPELINE — quiet window NOT covering "now" ⇒ email delivered
    // ===================================================================
    {
      const staff = await makeStaff("open-staff");
      const { eventType } = await makeTrigger("open", {
        assignedTherapist: true,
      });

      // A 2h window starting +3h from now never contains "now".
      const n = nowEtMinutes();
      await setGlobalPref(staff.id, {
        quietHoursStart: minutesToTime(n + 180),
        quietHoursEnd: minutesToTime(n + 300),
        weekendsEnabled: true,
      });

      await notificationService.processEvent(eventType, {
        id: 998000 + (process.pid % 1000),
        therapistId: staff.id,
      });

      assertEqual(
        callsFor(staff.email),
        1,
        "Staff email IS sent when the current time is OUTSIDE the quiet window",
      );
    }

    // ===================================================================
    // GATING UNIT — weekend muting (deterministic via injected clock)
    // ===================================================================
    {
      const staff = await makeStaff("weekend-staff");
      await setGlobalPref(staff.id, { weekendsEnabled: false });

      const sat = await svc.isDeliverySuppressedByQuietHours(
        staff.id,
        SATURDAY_NOON_ET,
      );
      assertEqual(
        sat.suppressed,
        true,
        "weekendsEnabled=false ⇒ SUPPRESSED on Saturday",
      );

      const sun = await svc.isDeliverySuppressedByQuietHours(
        staff.id,
        SUNDAY_NOON_ET,
      );
      assertEqual(
        sun.suppressed,
        true,
        "weekendsEnabled=false ⇒ SUPPRESSED on Sunday",
      );

      const mon = await svc.isDeliverySuppressedByQuietHours(
        staff.id,
        MONDAY_NOON_ET,
      );
      assertEqual(
        mon.suppressed,
        false,
        "weekendsEnabled=false ⇒ DELIVERED on a weekday",
      );
    }

    // ===================================================================
    // GATING UNIT — weekendsEnabled=true never mutes the weekend
    // ===================================================================
    {
      const staff = await makeStaff("weekend-on-staff");
      await setGlobalPref(staff.id, { weekendsEnabled: true });

      const sat = await svc.isDeliverySuppressedByQuietHours(
        staff.id,
        SATURDAY_NOON_ET,
      );
      assertEqual(
        sat.suppressed,
        false,
        "weekendsEnabled=true ⇒ NOT suppressed even on Saturday",
      );
    }

    // ===================================================================
    // GATING UNIT — midnight-wrapping quiet window (22:00 → 08:00)
    // ===================================================================
    {
      const staff = await makeStaff("wrap-staff");
      await setGlobalPref(staff.id, {
        quietHoursStart: "22:00:00",
        quietHoursEnd: "08:00:00",
        weekendsEnabled: true,
      });

      const at2300 = await svc.isDeliverySuppressedByQuietHours(
        staff.id,
        WRAP_2300_ET,
      );
      assertEqual(
        at2300.suppressed,
        true,
        "Wrapping window 22:00→08:00 ⇒ SUPPRESSED at 23:00 ET",
      );

      const at0200 = await svc.isDeliverySuppressedByQuietHours(
        staff.id,
        WRAP_0200_ET,
      );
      assertEqual(
        at0200.suppressed,
        true,
        "Wrapping window 22:00→08:00 ⇒ SUPPRESSED at 02:00 ET",
      );

      const atNoon = await svc.isDeliverySuppressedByQuietHours(
        staff.id,
        MONDAY_NOON_ET,
      );
      assertEqual(
        atNoon.suppressed,
        false,
        "Wrapping window 22:00→08:00 ⇒ DELIVERED at 12:00 ET",
      );
    }

    // ===================================================================
    // GATING UNIT — no global row at all ⇒ never suppressed
    // ===================================================================
    {
      const staff = await makeStaff("noglobal-staff");
      const res = await svc.isDeliverySuppressedByQuietHours(
        staff.id,
        SATURDAY_NOON_ET,
      );
      assertEqual(
        res.suppressed,
        false,
        "No global preference row ⇒ NEVER suppressed (default deliver)",
      );
    }
  } finally {
    restoreSparkPostStub();
    // Cleanup — remove everything we created (children before parents).
    try {
      if (createdUserIds.length > 0) {
        await db
          .delete(notifications)
          .where(inArray(notifications.userId, createdUserIds));
        await db
          .delete(notificationPreferences)
          .where(inArray(notificationPreferences.userId, createdUserIds));
      }
      if (createdTriggerIds.length > 0) {
        await db
          .delete(notificationTriggers)
          .where(inArray(notificationTriggers.id, createdTriggerIds));
      }
      if (createdTemplateIds.length > 0) {
        await db
          .delete(notificationTemplates)
          .where(inArray(notificationTemplates.id, createdTemplateIds));
      }
      if (createdClientIds.length > 0) {
        // Client-email tracking rows are stored under the system user; clear any
        // we created so we don't leave orphans referencing deleted clients.
        await db
          .delete(notifications)
          .where(inArray(notifications.relatedEntityId, createdClientIds));
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

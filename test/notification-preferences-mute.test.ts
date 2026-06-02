/**
 * Automated Tests: muting a notification channel actually stops the alert.
 *
 * Therapists can toggle in-app and email delivery on/off per event type in the
 * Preferences tab. Those toggles write `notificationPreferences` rows keyed by
 * (userId, triggerType) with the boolean flags `enableInApp` / `enableEmail`
 * (see .agents/memory/notification-pref-delivery.md). Server-side delivery in
 * `server/notification-service.ts` honors those flags:
 *
 *   - In-app: `createNotificationsFromTrigger` filters out any recipient whose
 *     row has `enableInApp === false`. No row => delivered (default ON).
 *   - Email:  `sendEmailNotifications` skips any recipient whose row does NOT
 *     have email enabled. No row => delivered (default ON).
 *
 * This suite locks in that guarantee so a regression can't silently start
 * sending (or silently start dropping) notifications:
 *
 *   1. Email OFF  => no email is sent (but in-app still delivered).
 *   2. In-app OFF => no in-app notification row is created (but email still sent).
 *   3. No pref row => BOTH channels deliver (default ON).
 *
 * All three users are recipients of a SINGLE fired event, which also proves the
 * filtering is per-user/per-channel and not all-or-nothing.
 *
 * The SparkPost provider is stubbed at `SparkPost.prototype.post` (the single
 * method `transmissions.send` funnels through), so no real email is sent and no
 * cost is incurred. Counting sends per-recipient email isolates OUR test users
 * from any other recipients that happen to exist in the shared dev DB.
 *
 * Run with: npx tsx test/notification-preferences-mute.test.ts
 *
 * NOTES:
 * - This is DB-backed: it seeds dedicated, uniquely-named users + a dedicated
 *   trigger with a unique eventType (so no seeded trigger also fires) and
 *   removes everything it created at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md); it is chained into the
 *   `test-privacy` validation.
 */

// Provider + sender config must be present so sendEmailNotifications does real
// work; the actual network call is stubbed below, so the values are fake.
process.env.SPARKPOST_API_KEY = process.env.SPARKPOST_API_KEY || "test-sparkpost-key";
process.env.EMAIL_FROM = process.env.EMAIL_FROM || "notify@example.test";

import SparkPost from "sparkpost";
import { db } from "../server/db";
import {
  users,
  notifications,
  notificationTriggers,
  notificationPreferences,
} from "../shared/schema";
import { storage } from "../server/storage";
import { notificationService } from "../server/notification-service";
import { and, eq, inArray } from "drizzle-orm";

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

const SUFFIX = `notif-mute-${Date.now()}`;
// Unique eventType so ONLY our dedicated trigger fires (no seeded trigger
// shares it) — keeps the test hermetic in the shared dev DB.
const EVENT_TYPE = `test_mute_event_${Date.now()}`;
const createdUserIds: number[] = [];
let triggerId: number | null = null;

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
    for (const email of recipientEmails(options)) {
      postCallsByEmail.set(email, (postCallsByEmail.get(email) ?? 0) + 1);
    }
    return { results: { id: `mock-${Date.now()}` } };
  };
}

function restoreSparkPostStub() {
  (SparkPost.prototype as any).post = originalPost;
}

function emailsSentTo(email: string): number {
  return postCallsByEmail.get(email) ?? 0;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function makeUser(label: string) {
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

async function inAppRowsFor(userId: number): Promise<number> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, EVENT_TYPE),
      ),
    );
  return rows.length;
}

// ---------------------------------------------------------------------------
async function main() {
  installSparkPostStub();

  try {
    // userEmailOff: email muted, in-app left ON.
    const userEmailOff = await makeUser("email-off");
    // userInAppOff: in-app muted, email left ON.
    const userInAppOff = await makeUser("inapp-off");
    // userDefault: NO preference row at all (both channels default ON).
    const userDefault = await makeUser("default-on");

    // Dedicated trigger that notifies the session's assigned therapist. We fire
    // one event per user (each event names that user as the assigned therapist),
    // so each user is the sole recipient of their own event.
    const [trigger] = await db
      .insert(notificationTriggers)
      .values({
        name: `Mute Test Trigger ${SUFFIX}`,
        description: "Dedicated trigger for the notification-mute test",
        eventType: EVENT_TYPE as any,
        entityType: "session" as any,
        conditionRules: "{}",
        recipientRules: JSON.stringify({ assignedTherapist: true }),
        priority: "medium",
        isScheduled: false,
        isActive: true,
      })
      .returning();
    triggerId = trigger.id;

    // Preference rows. The UI always writes BOTH booleans together, so we do
    // the same here (see .agents/memory/notification-pref-delivery.md).
    await db.insert(notificationPreferences).values([
      {
        userId: userEmailOff.id,
        triggerType: EVENT_TYPE,
        enableInApp: true,
        enableEmail: false, // muted channel
      },
      {
        userId: userInAppOff.id,
        triggerType: EVENT_TYPE,
        enableInApp: false, // muted channel
        enableEmail: true,
      },
    ]);

    // Fire one event per user, each naming that user as the assigned therapist.
    // A valid sessionDate is supplied because the in-app message generator
    // formats it; the trigger is non-scheduled so it sends immediately.
    const sessionDate = "2099-06-01T15:00:00.000Z";
    await notificationService.processEvent(EVENT_TYPE, {
      id: 999000001,
      therapistId: userEmailOff.id,
      sessionDate,
    });
    await notificationService.processEvent(EVENT_TYPE, {
      id: 999000002,
      therapistId: userInAppOff.id,
      sessionDate,
    });
    await notificationService.processEvent(EVENT_TYPE, {
      id: 999000003,
      therapistId: userDefault.id,
      sessionDate,
    });

    // -------------------------------------------------------------------
    // Test 1: email disabled => no email sent (in-app still delivered).
    // -------------------------------------------------------------------
    assertEqual(
      emailsSentTo(userEmailOff.email),
      0,
      "Email-disabled user receives NO email",
    );
    assertEqual(
      await inAppRowsFor(userEmailOff.id),
      1,
      "Email-disabled user STILL gets the in-app notification (other channel unaffected)",
    );

    // -------------------------------------------------------------------
    // Test 2: in-app disabled => no in-app row created (email still sent).
    // -------------------------------------------------------------------
    assertEqual(
      await inAppRowsFor(userInAppOff.id),
      0,
      "In-app-disabled user gets NO in-app notification row",
    );
    assertEqual(
      emailsSentTo(userInAppOff.email),
      1,
      "In-app-disabled user STILL gets the email (other channel unaffected)",
    );

    // -------------------------------------------------------------------
    // Test 3: no preference row => BOTH channels deliver (default ON).
    // -------------------------------------------------------------------
    assertEqual(
      emailsSentTo(userDefault.email),
      1,
      "User with no preference row receives the email (default ON)",
    );
    assertEqual(
      await inAppRowsFor(userDefault.id),
      1,
      "User with no preference row gets the in-app notification (default ON)",
    );
  } finally {
    restoreSparkPostStub();
    // Cleanup: preferences + in-app rows + trigger + users.
    try {
      if (createdUserIds.length > 0) {
        await db
          .delete(notificationPreferences)
          .where(inArray(notificationPreferences.userId, createdUserIds));
        await db
          .delete(notifications)
          .where(inArray(notifications.userId, createdUserIds));
      }
      if (triggerId !== null) {
        await db
          .delete(notificationTriggers)
          .where(eq(notificationTriggers.id, triggerId));
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

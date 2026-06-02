/**
 * Automated Tests: the `specificUsers` recipient rule actually delivers.
 *
 * A notification trigger can target a hand-picked list of users via the
 * `specificUsers` recipient rule (an array of user ids in `recipientRules`).
 * Server-side resolution happens in `calculateRecipients`
 * (`server/notification-service.ts`).
 *
 * This path used to silently deliver to NOBODY: the query built a raw
 * `sql\`${users.id} = ANY(${jsArray})\`` fragment which throws at runtime on the
 * neon serverless driver (see .agents/memory/drizzle-any-array-neon.md). The
 * throw was swallowed by the try/catch in `calculateRecipients` that returns
 * `[]`, so the trigger fired but reached zero recipients with no visible error.
 * The fix switches that branch to `inArray(users.id, ...)`.
 *
 * This suite locks in the guarantee so the bug can't silently regress:
 *
 *   1. Both hand-picked users receive the in-app notification AND the email.
 *   2. A user NOT in the list receives neither (proves it's a targeted list,
 *      not an all-users broadcast).
 *
 * The SparkPost provider is stubbed at `SparkPost.prototype.post` so no real
 * email is sent and no cost is incurred. Counting sends per-recipient email
 * isolates OUR test users from any other recipients in the shared dev DB.
 *
 * Run with: npx tsx test/notification-specific-users.test.ts
 *
 * NOTES:
 * - This is DB-backed: it seeds dedicated, uniquely-named users + a dedicated
 *   trigger with a unique eventType (so no seeded trigger also fires) and
 *   removes everything it created at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md).
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

const SUFFIX = `notif-specific-${Date.now()}`;
// Unique eventType so ONLY our dedicated trigger fires (no seeded trigger
// shares it) — keeps the test hermetic in the shared dev DB.
const EVENT_TYPE = `test_specific_event_${Date.now()}`;
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
    // Two hand-picked recipients that the trigger explicitly targets.
    const userPicked1 = await makeUser("picked-1");
    const userPicked2 = await makeUser("picked-2");
    // A user that exists and is active but is NOT in the targeted list.
    const userNotPicked = await makeUser("not-picked");

    // Dedicated trigger targeting ONLY the two picked users via specificUsers.
    const [trigger] = await db
      .insert(notificationTriggers)
      .values({
        name: `Specific Users Test Trigger ${SUFFIX}`,
        description: "Dedicated trigger for the specificUsers recipient test",
        eventType: EVENT_TYPE as any,
        entityType: "session" as any,
        conditionRules: "{}",
        recipientRules: JSON.stringify({
          specificUsers: [userPicked1.id, userPicked2.id],
        }),
        priority: "medium",
        isScheduled: false,
        isActive: true,
      })
      .returning();
    triggerId = trigger.id;

    // Fire a single event. A valid sessionDate is supplied because the in-app
    // message generator formats it; the trigger is non-scheduled so it sends
    // immediately.
    const sessionDate = "2099-06-01T15:00:00.000Z";
    await notificationService.processEvent(EVENT_TYPE, {
      id: 999100001,
      sessionDate,
    });

    // -------------------------------------------------------------------
    // Test 1: both picked users get the in-app notification AND the email.
    // -------------------------------------------------------------------
    assertEqual(
      await inAppRowsFor(userPicked1.id),
      1,
      "Picked user #1 receives the in-app notification",
    );
    assertEqual(
      emailsSentTo(userPicked1.email),
      1,
      "Picked user #1 receives the email",
    );
    assertEqual(
      await inAppRowsFor(userPicked2.id),
      1,
      "Picked user #2 receives the in-app notification",
    );
    assertEqual(
      emailsSentTo(userPicked2.email),
      1,
      "Picked user #2 receives the email",
    );

    // -------------------------------------------------------------------
    // Test 2: a user NOT in the list receives neither channel.
    // -------------------------------------------------------------------
    assertEqual(
      await inAppRowsFor(userNotPicked.id),
      0,
      "Non-targeted user receives NO in-app notification",
    );
    assertEqual(
      emailsSentTo(userNotPicked.email),
      0,
      "Non-targeted user receives NO email",
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

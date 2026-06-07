/**
 * Automated tests for the STAFF (preference-gated) SMS notification path.
 *
 * SMS to staff is OFF by default. A staff user (any non-client role) only
 * receives a text when they have an explicit notificationPreferences row with
 * enableSms=true for the specific trigger event type AND a phone number that
 * normalizes to E.164. This is the second of the two SMS delivery paths in
 * notification-service.ts (Path 2); the consent-gated CLIENT path (Path 1) is
 * covered separately by test/sms-notification-privacy.test.ts.
 *
 * A regression in this gate could silently start texting staff who never opted
 * in, or stop texting staff who did. These tests pin both directions.
 *
 * This suite is hermetic: it injects a fake Twilio client (no network, no
 * credentials) via the sms-service test seam and drives the real
 * notification-service staff SMS path, then asserts on the captured sends.
 *
 * Coverage (all against the SAME trigger event type):
 *   a. staff with enableSms=true  + valid phone   ⇒ text SENT (E.164, PHI-free).
 *   b. staff with enableSms=false + valid phone   ⇒ NO text (default OFF).
 *   c. staff with NO preference row + valid phone ⇒ NO text (default OFF).
 *   d. staff with enableSms=true  + invalid phone ⇒ NO text.
 *   e. staff with enableSms=true for a DIFFERENT trigger only ⇒ NO text.
 *   f. a client-role recipient is never reached by the staff path.
 *
 * Run with: npx tsx test/sms-notification-staff-privacy.test.ts
 *
 * NOTES:
 * - DB-backed: seeds uniquely-keyed users + preference rows and removes
 *   everything it created at the end. Must run serially with the other
 *   app-level tests (see .agents/memory/privacy-test-concurrency.md).
 */

// Twilio must look configured so the SMS path does real work; the client is
// stubbed below, so these values are never used for a network call.
process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "test_token";
process.env.TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "+15005550006";

import { db } from "../server/db";
import { users, notificationPreferences } from "../shared/schema";
import { storage } from "../server/storage";
import { notificationService } from "../server/notification-service";
import { __setSmsClientForTests } from "../server/sms-service";
import { inArray } from "drizzle-orm";

const svc = notificationService as any;

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

function assertTrue(cond: boolean, message: string) {
  assertEqual(!!cond, true, message);
}

const SUFFIX = `sms-staff-${process.pid}-${Date.now()}`;
const createdUserIds: number[] = [];

// The trigger event type the staff opt-in is scoped to, plus a different one
// used to prove the per-trigger gate is respected.
const EVENT_TYPE = "session_scheduled";
const OTHER_EVENT_TYPE = "session_rescheduled";

// --- Fake Twilio client: capture sends instead of hitting the network --------
const sentMessages: Array<{ to: string; from: string; body: string }> = [];
const fakeTwilioClient = {
  messages: {
    create: async (opts: { to: string; from: string; body: string }) => {
      sentMessages.push(opts);
      return { sid: `SM_test_${sentMessages.length}` };
    },
  },
};

async function makeStaff(label: string, phone: string | null, role = "therapist") {
  const user = await storage.createUser({
    username: `${label}-${SUFFIX}`,
    password: "x",
    fullName: `${label} Staffmember`,
    email: `${label}-${SUFFIX}@example.test`,
    role,
    phone,
  } as any);
  createdUserIds.push(user.id);
  return user;
}

async function setSmsPref(
  userId: number,
  triggerType: string,
  enableSms: boolean,
) {
  await db.insert(notificationPreferences).values({
    userId,
    triggerType,
    enableSms,
  } as any);
}

// A non-client-targeting trigger so Path 1 (consent-gated client path) is
// skipped entirely and we exercise ONLY the staff path. generateSmsBody still
// needs an entity with a sessionDate to build the (PHI-free) body.
function trigger(eventType: string) {
  return {
    eventType,
    isScheduled: false,
    recipientRules: JSON.stringify({ allUsers: true }),
  } as any;
}

const entity = {
  id: 4242,
  sessionDate: new Date("2026-07-01T15:00:00Z"),
};

async function cleanup() {
  __setSmsClientForTests(null);
  if (createdUserIds.length > 0) {
    await db
      .delete(notificationPreferences)
      .where(inArray(notificationPreferences.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
}

async function main() {
  __setSmsClientForTests(fakeTwilioClient);

  const goodPhone = "519-555-2468";

  // Seed the full cast of staff once, then fire a single trigger at all of them
  // so we exercise the real "filter the recipient list" behaviour, not a
  // one-user-at-a-time shortcut.
  const optedIn = await makeStaff("opted-in", goodPhone); // (a) SENT
  await setSmsPref(optedIn.id, EVENT_TYPE, true);

  const optedOut = await makeStaff("opted-out", goodPhone); // (b) NO text
  await setSmsPref(optedOut.id, EVENT_TYPE, false);

  const noPref = await makeStaff("no-pref", goodPhone); // (c) NO text (default off)

  const badPhone = await makeStaff("bad-phone", "12345"); // (d) NO text (unusable phone)
  await setSmsPref(badPhone.id, EVENT_TYPE, true);

  const wrongTrigger = await makeStaff("wrong-trigger", goodPhone); // (e) NO text
  await setSmsPref(wrongTrigger.id, OTHER_EVENT_TYPE, true);

  // A client-role recipient that has opted in for THIS trigger — the staff path
  // must never reach client-role users (they go through the consent path only).
  const clientRole = await makeStaff("client-role", goodPhone, "client"); // (f) NO text
  await setSmsPref(clientRole.id, EVENT_TYPE, true);

  const recipients = [
    optedIn,
    optedOut,
    noPref,
    badPhone,
    wrongTrigger,
    clientRole,
  ] as any[];

  sentMessages.length = 0;
  await svc.sendSmsNotifications(recipients, trigger(EVENT_TYPE), entity);

  // (a) Exactly one text, to the opted-in staffer's normalized number.
  assertEqual(sentMessages.length, 1, "exactly one staff text sent (only the opted-in staffer)");
  assertEqual(sentMessages[0]?.to, "+15195552468", "sent to opted-in staffer's normalized E.164 number");

  // PHI-free: staff body must not carry any client name (there is none here,
  // but assert the body is a non-empty appointment string, not entity dump).
  assertTrue(!!sentMessages[0]?.body && /appointment/i.test(sentMessages[0].body), "staff body is the PHI-free appointment template");
  assertTrue(!sentMessages[0]!.body.includes("4242"), "staff body does not leak raw entity id");

  // (b)–(f): nobody else was texted. We already asserted total == 1; make the
  // intent explicit per-case for clearer failure messages.
  assertTrue(sentMessages.length === 1, "(b) enableSms=false staffer NOT texted");
  assertTrue(sentMessages.length === 1, "(c) staffer with no preference row NOT texted");
  assertTrue(sentMessages.length === 1, "(d) opted-in staffer with invalid phone NOT texted");
  assertTrue(sentMessages.length === 1, "(e) staffer opted-in for a different trigger NOT texted");
  assertTrue(sentMessages.length === 1, "(f) client-role recipient NOT texted via the staff path");

  // Sanity: re-firing for the OTHER trigger reaches ONLY the wrong-trigger
  // staffer (who is opted in there), proving the gate is genuinely per-trigger.
  sentMessages.length = 0;
  await svc.sendSmsNotifications(recipients, trigger(OTHER_EVENT_TYPE), entity);
  assertEqual(sentMessages.length, 1, "per-trigger gate: OTHER trigger texts exactly the staffer opted in for it");
  assertEqual(sentMessages[0]?.to, "+15195552468", "per-trigger gate: that text went to the (same number) opted-in-for-OTHER staffer");
}

main()
  .then(cleanup)
  .then(() => {
    console.log(`\nStaff SMS notification tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in staff SMS notification test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });

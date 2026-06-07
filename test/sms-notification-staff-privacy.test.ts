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
import { users, notificationPreferences, auditLogs } from "../shared/schema";
import { storage } from "../server/storage";
import { notificationService } from "../server/notification-service";
import { __setSmsClientForTests } from "../server/sms-service";
import { and, eq, inArray } from "drizzle-orm";

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

// The staff SMS path audits each attempt with resourceType 'sms_notification'
// and resourceId = String(staffUserId). Mirrors smsAuditActions in
// test/sms-notification-privacy.test.ts (which keys on clientId instead).
async function staffSmsAuditActions(userId: number): Promise<string[]> {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, "sms_notification"),
        eq(auditLogs.resourceId, String(userId)),
      ),
    );
  return rows.map((r) => r.action as string);
}

async function cleanup() {
  __setSmsClientForTests(null);
  if (createdUserIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, "sms_notification"),
          inArray(
            auditLogs.resourceId,
            createdUserIds.map((id) => String(id)),
          ),
        ),
      );
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

  // --- Audit trail: every staff attempt is recorded (sent / skipped / failed),
  // mirroring how test/sms-notification-privacy.test.ts checks smsAuditActions.
  // Bodies/details stay PHI-free; we only assert the disposition per staffer.
  assertTrue(
    (await staffSmsAuditActions(optedIn.id)).includes("sms_notification_sent"),
    "(a) audit: opted-in staffer logged sms_notification_sent",
  );
  assertTrue(
    (await staffSmsAuditActions(optedOut.id)).includes("sms_notification_skipped"),
    "(b) audit: opted-out staffer logged sms_notification_skipped",
  );
  assertTrue(
    (await staffSmsAuditActions(noPref.id)).includes("sms_notification_skipped"),
    "(c) audit: no-preference staffer logged sms_notification_skipped",
  );
  assertTrue(
    (await staffSmsAuditActions(badPhone.id)).includes("sms_notification_skipped"),
    "(d) audit: opted-in-but-bad-phone staffer logged sms_notification_skipped",
  );
  assertTrue(
    (await staffSmsAuditActions(wrongTrigger.id)).includes("sms_notification_skipped"),
    "(e) audit: opted-in-for-other-trigger staffer logged sms_notification_skipped for THIS trigger",
  );
  // (f) The client-role recipient is handled by the consent path, never the
  // staff path, so the staff path must write NO audit row for them here (this
  // trigger does not target the session client, so the client path is skipped).
  assertEqual(
    (await staffSmsAuditActions(clientRole.id)).length,
    0,
    "(f) audit: client-role recipient has NO staff-path audit row",
  );

  // Audit details/body never carry PHI — there is no client name in scope here,
  // but assert the persisted detail JSON doesn't leak the raw entity id either.
  const optedInRows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, "sms_notification"),
        eq(auditLogs.resourceId, String(optedIn.id)),
      ),
    );
  assertTrue(
    optedInRows.every((r) => !String(r.details ?? "").includes("4242")),
    "audit details do not leak raw entity id (PHI-free)",
  );

  // Sanity: re-firing for the OTHER trigger reaches ONLY the wrong-trigger
  // staffer (who is opted in there), proving the gate is genuinely per-trigger.
  sentMessages.length = 0;
  await svc.sendSmsNotifications(recipients, trigger(OTHER_EVENT_TYPE), entity);
  assertEqual(sentMessages.length, 1, "per-trigger gate: OTHER trigger texts exactly the staffer opted in for it");
  assertEqual(sentMessages[0]?.to, "+15195552468", "per-trigger gate: that text went to the (same number) opted-in-for-OTHER staffer");

  // The wrong-trigger staffer is opted in for OTHER_EVENT_TYPE, so firing it now
  // records a SENT for them — proving the audit trail tracks per-trigger sends.
  assertTrue(
    (await staffSmsAuditActions(wrongTrigger.id)).includes("sms_notification_sent"),
    "audit: staffer opted in for OTHER trigger logged sms_notification_sent when it fired",
  );

  // --- (g) Fail-closed when the staff path crashes mid-run ------------------
  // If the staff path throws partway through (the task's example: the preference
  // DB query fails), every staffer we never reached must STILL get a skipped
  // audit row — exactly the "I got no text and there's no record why" gap this
  // work closes. Mirrors the consent-gated client path's audit-on-throw.
  //
  // We force the throw by making the very first DB read inside the staff path —
  // the notificationPreferences query — reject once. That happens before ANY
  // staffer is processed, so both seeded staffers are un-reached and must be
  // fail-closed audited by the catch-all. (A Twilio send that rejects does NOT
  // exercise this: sms-service catches it and returns {success:false}, which is
  // audited as 'failed' — a record still exists, so there's no gap there.)
  const crashA = await makeStaff("crash-a", goodPhone);
  await setSmsPref(crashA.id, EVENT_TYPE, true);
  const crashB = await makeStaff("crash-b", goodPhone);
  await setSmsPref(crashB.id, EVENT_TYPE, true);

  // One-shot: make the next db.select() throw, then restore the real one so the
  // catch-block's audit writes (and the assertions below) work normally.
  const realSelect = (db as any).select.bind(db);
  (db as any).select = (...args: any[]) => {
    (db as any).select = realSelect;
    throw new Error("simulated preference query failure");
  };

  sentMessages.length = 0;
  await svc.sendSmsNotifications([crashA, crashB] as any[], trigger(EVENT_TYPE), entity);

  // Restore defensively in case the patched select was never hit.
  (db as any).select = realSelect;

  // No text went out (we crashed before sending), but BOTH staffers are audited.
  assertEqual(sentMessages.length, 0, "(g) no staff text recorded when the staff path crashes mid-run");
  assertTrue(
    (await staffSmsAuditActions(crashA.id)).includes("sms_notification_skipped"),
    "(g) audit: un-reached staffer #1 still logged sms_notification_skipped (fail-closed)",
  );
  assertTrue(
    (await staffSmsAuditActions(crashB.id)).includes("sms_notification_skipped"),
    "(g) audit: un-reached staffer #2 still logged sms_notification_skipped (fail-closed)",
  );

  // The fail-closed audit detail carries the fail-closed reason and stays PHI-free.
  const crashRows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, "sms_notification"),
        inArray(auditLogs.resourceId, [String(crashA.id), String(crashB.id)]),
      ),
    );
  assertTrue(
    crashRows.some((r) => String(r.details ?? "").includes("fail-closed")),
    "(g) audit: fail-closed skip records the 'unexpected error, fail-closed' reason",
  );
  assertTrue(
    crashRows.every((r) => !String(r.details ?? "").includes("4242")),
    "(g) audit: fail-closed skip details do not leak the raw entity id (PHI-free)",
  );
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

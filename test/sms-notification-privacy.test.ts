/**
 * Automated tests for CONSENT-GATED SMS appointment notifications (Twilio).
 *
 * SMS is OFF by default for every client. A text is only sent when a staff
 * member has recorded the client's explicit SMS approval (consentType
 * 'sms_notifications') AND the client has a usable mobile number. The gate is
 * FAIL-CLOSED: missing/withdrawn consent, an unverifiable consent, or an
 * invalid phone all result in NO text. Message bodies must never contain PHI
 * (no client name / clinical detail). Every attempt is audit-logged.
 *
 * This suite is hermetic: it injects a fake Twilio client (no network, no
 * credentials) via the sms-service test seam and drives the real
 * notification-service SMS path, then asserts on the captured sends and the
 * audit_logs rows written.
 *
 * Coverage:
 *   1. normalizePhoneE164 — NANP 10-digit, 11-digit, +international, junk.
 *   2. generateSmsBody — confirmation vs reschedule vs scheduled-reminder
 *      wording, null for unrelated events, and PHI-free (no client name).
 *   3. checkSmsConsent — fail-closed: none / granted / withdrawn.
 *   4. Full SMS path:
 *      a. consent granted + valid phone  ⇒ text SENT (E.164 to, PHI-free body),
 *         audit 'sms_notification_sent'.
 *      b. consent withdrawn              ⇒ NO text, audit 'sms_notification_blocked'.
 *      c. consent granted + bad phone    ⇒ NO text, audit 'sms_notification_blocked'.
 *
 * Run with: npx tsx test/sms-notification-privacy.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a uniquely-keyed client + consents and removes everything
 *   it created at the end. Must run serially with the other app-level tests
 *   (see .agents/memory/privacy-test-concurrency.md).
 */

// Twilio must look configured so the SMS path does real work; the client is
// stubbed below, so these values are never used for a network call.
process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "test_token";
process.env.TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "+15005550006";

import { db } from "../server/db";
import { clients, patientConsents, auditLogs } from "../shared/schema";
import { storage } from "../server/storage";
import { notificationService } from "../server/notification-service";
import { checkSmsConsent } from "../server/routes-helpers";
import { normalizePhoneE164, __setSmsClientForTests } from "../server/sms-service";
import { eq, and, inArray } from "drizzle-orm";

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

const SUFFIX = `sms-${process.pid}-${Date.now()}`;
const createdClientIds: number[] = [];

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

async function makeClient(label: string, phone: string | null, fullName: string) {
  const unique = `${process.pid}${Date.now() % 100000}`.slice(-13);
  const [client] = await db
    .insert(clients)
    .values({
      clientId: `CL-${unique}`.slice(0, 20),
      fullName,
      email: `${label}-${SUFFIX}@example.test`,
      // Deliberately OFF: SMS must reach a consenting client even when they
      // declined email — proves SMS is not coupled to the email recipient gate.
      emailNotifications: false,
      phone,
      status: "active",
    } as any)
    .returning();
  createdClientIds.push(client.id);
  return client;
}

async function recordConsent(clientId: number, granted: boolean, withdrawn: boolean) {
  const consent = await storage.createClientConsent({
    clientId,
    consentType: "sms_notifications",
    granted,
    consentVersion: "1.0.0",
    ipAddress: "",
    userAgent: "",
    notes: `test ${granted ? "granted" : "withdrawn"}`,
  } as any);
  if (withdrawn) {
    await db
      .update(patientConsents)
      .set({ withdrawnAt: new Date() })
      .where(eq(patientConsents.id, consent.id));
  }
  return consent;
}

// A scheduled trigger represents the 24h advance reminder; an immediate one the
// booking confirmation. Both target the session client.
function trigger(eventType: string, isScheduled: boolean) {
  return {
    eventType,
    isScheduled,
    recipientRules: JSON.stringify({ sessionClient: true }),
  } as any;
}

async function smsAuditActions(clientId: number): Promise<string[]> {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, "sms_notification"),
        eq(auditLogs.resourceId, String(clientId)),
      ),
    );
  return rows.map((r) => r.action as string);
}

async function cleanup() {
  __setSmsClientForTests(null);
  if (createdClientIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, "sms_notification"),
          inArray(
            auditLogs.resourceId,
            createdClientIds.map((id) => String(id)),
          ),
        ),
      );
    await db
      .delete(patientConsents)
      .where(inArray(patientConsents.clientId, createdClientIds));
    await db.delete(clients).where(inArray(clients.id, createdClientIds));
  }
}

async function main() {
  __setSmsClientForTests(fakeTwilioClient);

  // --- 1. normalizePhoneE164 (pure) -----------------------------------------
  assertEqual(normalizePhoneE164("(519) 555-1234"), "+15195551234", "10-digit NANP -> +1");
  assertEqual(normalizePhoneE164("15195551234"), "+15195551234", "11-digit leading 1 -> +1");
  assertEqual(normalizePhoneE164("+44 20 7946 0958"), "+442079460958", "international + preserved");
  assertEqual(normalizePhoneE164("12345"), null, "too-short junk -> null");
  assertEqual(normalizePhoneE164(""), null, "empty -> null");
  assertEqual(normalizePhoneE164(null), null, "null -> null");

  // --- 2. generateSmsBody (PHI-free, correct wording) ------------------------
  const PHI_NAME = "Johnathan Privacy-Smith";
  const entity = { id: 999000, clientId: 999000, clientName: PHI_NAME, sessionDate: new Date("2026-07-01T15:00:00Z") };
  const confirmBody = svc.generateSmsBody(trigger("session_scheduled", false), entity);
  const reschedBody = svc.generateSmsBody(trigger("session_rescheduled", false), entity);
  const reminderBody = svc.generateSmsBody(trigger("session_scheduled", true), entity);
  const unrelated = svc.generateSmsBody(trigger("client_created", false), entity);

  assertTrue(/confirmed/i.test(confirmBody), "confirmation body says 'confirmed'");
  assertTrue(/rescheduled/i.test(reschedBody), "reschedule body says 'rescheduled'");
  assertTrue(/reminder/i.test(reminderBody), "scheduled trigger -> reminder wording (not 'confirmed')");
  assertEqual(unrelated, null, "unrelated event -> no SMS body");
  for (const [name, body] of [["confirm", confirmBody], ["reschedule", reschedBody], ["reminder", reminderBody]] as const) {
    assertTrue(!body.includes(PHI_NAME), `${name} body contains NO client name (PHI-free)`);
    assertTrue(/STOP/i.test(body), `${name} body includes STOP opt-out notice`);
  }

  // --- 3 + 4. consent gate + full path --------------------------------------
  const goodPhone = "519-555-7777";

  // (a) granted + valid phone -> SENT
  const granted = await makeClient("granted", goodPhone, "Granted Client");
  await recordConsent(granted.id, true, false);
  const consentA = await checkSmsConsent(granted.id);
  assertEqual(consentA.hasConsent, true, "checkSmsConsent: granted -> true");
  sentMessages.length = 0;
  await svc.sendSmsNotifications([], trigger("session_scheduled", false), { id: granted.id, clientId: granted.id, clientName: "Granted Client", sessionDate: new Date("2026-07-01T15:00:00Z") });
  assertEqual(sentMessages.length, 1, "granted+phone: exactly one text sent");
  assertEqual(sentMessages[0]?.to, "+15195557777", "sent to normalized E.164 number");
  assertTrue(!sentMessages[0]?.body.includes("Granted Client"), "sent body is PHI-free");
  assertTrue((await smsAuditActions(granted.id)).includes("sms_notification_sent"), "audit logged: sms_notification_sent");

  // (b) withdrawn -> BLOCKED, no text
  const withdrawn = await makeClient("withdrawn", goodPhone, "Withdrawn Client");
  await recordConsent(withdrawn.id, true, true);
  const consentB = await checkSmsConsent(withdrawn.id);
  assertEqual(consentB.hasConsent, false, "checkSmsConsent: withdrawn -> false (fail-closed)");
  sentMessages.length = 0;
  await svc.sendSmsNotifications([], trigger("session_scheduled", false), { id: withdrawn.id, clientId: withdrawn.id, sessionDate: new Date("2026-07-01T15:00:00Z") });
  assertEqual(sentMessages.length, 0, "withdrawn consent: NO text sent");
  assertTrue((await smsAuditActions(withdrawn.id)).includes("sms_notification_blocked"), "audit logged: sms_notification_blocked (withdrawn)");

  // (b2) no consent recorded at all -> false
  const none = await makeClient("none", goodPhone, "No Consent Client");
  const consentNone = await checkSmsConsent(none.id);
  assertEqual(consentNone.hasConsent, false, "checkSmsConsent: no record -> false (default off)");
  sentMessages.length = 0;
  await svc.sendSmsNotifications([], trigger("session_scheduled", false), { id: none.id, clientId: none.id, sessionDate: new Date("2026-07-01T15:00:00Z") });
  assertEqual(sentMessages.length, 0, "no consent: NO text sent");
  assertTrue((await smsAuditActions(none.id)).includes("sms_notification_blocked"), "audit logged: sms_notification_blocked (no consent record)");

  // (c) granted + invalid/missing phone -> BLOCKED, no text
  const badPhone = await makeClient("badphone", "12345", "Bad Phone Client");
  await recordConsent(badPhone.id, true, false);
  sentMessages.length = 0;
  await svc.sendSmsNotifications([], trigger("session_scheduled", false), { id: badPhone.id, clientId: badPhone.id, sessionDate: new Date("2026-07-01T15:00:00Z") });
  assertEqual(sentMessages.length, 0, "granted but invalid phone: NO text sent");
  assertTrue((await smsAuditActions(badPhone.id)).includes("sms_notification_blocked"), "audit logged: sms_notification_blocked (bad phone)");
}

main()
  .then(cleanup)
  .then(() => {
    console.log(`\nSMS notification tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in SMS notification test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });

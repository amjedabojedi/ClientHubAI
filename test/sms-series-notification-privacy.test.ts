/**
 * Automated tests for the CONSENT-GATED *series* (recurring / multi-date)
 * confirmation SMS (Twilio).
 *
 * When a recurring series of appointments is booked, the client must receive
 * exactly ONE combined confirmation text that lists every booked date — the
 * single-booking path already texts a confirmation, and the series path must
 * too. This path previously regressed (it sent only in-app + email and silently
 * texted nothing), so this hermetic suite locks the behavior in.
 *
 * Same rules as the single-booking SMS path:
 *   - FAIL-CLOSED gate: missing / withdrawn consent, or an invalid phone, all
 *     result in NO text plus a `sms_notification_blocked` audit row.
 *   - The SMS section runs BEFORE the email early-returns, so a client who
 *     declined EMAIL still gets the confirmation TEXT (the consenting client
 *     seeded here has emailNotifications = false to prove exactly that).
 *   - Bodies are PHI-free: dates / times only, never the client's name.
 *   - Every attempt is audit-logged with `series: true`.
 *
 * This suite is hermetic: it injects a fake Twilio client (no network, no
 * credentials) via the sms-service test seam and drives the real
 * notification-service series path, then asserts on the captured sends and the
 * audit_logs rows written.
 *
 * Run with: npx tsx test/sms-series-notification-privacy.test.ts
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
import { __setSmsClientForTests } from "../server/sms-service";
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

const SUFFIX = `smsseries-${process.pid}-${Date.now()}`;
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
      // Deliberately OFF: the series SMS must reach a consenting client even
      // when they declined email — proves the text is sent BEFORE the email
      // section's early-return, not coupled to the email recipient gate.
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

// Full audit rows (with parsed details) for a client's SMS notifications.
async function smsAuditRows(
  clientId: number,
): Promise<Array<{ action: string; result: string; details: any }>> {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, "sms_notification"),
        eq(auditLogs.resourceId, String(clientId)),
      ),
    );
  return rows.map((r) => {
    let details: any = {};
    try {
      details = r.details ? JSON.parse(r.details as string) : {};
    } catch {
      details = {};
    }
    return { action: r.action as string, result: r.result as string, details };
  });
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

// Three booked dates for the recurring series.
const SERIES_DATES = [
  new Date("2026-07-01T15:00:00Z"),
  new Date("2026-07-08T15:00:00Z"),
  new Date("2026-07-15T15:00:00Z"),
];

function seriesData(clientId: number, clientName: string) {
  return {
    clientId,
    therapistId: 6, // SYSTEM_USER_ID exists; safe FK for the in-app notification
    clientName,
    therapistName: "Dr. Test",
    serviceName: "Therapy",
    roomName: "Room 1",
    sessionDates: SERIES_DATES,
  };
}

async function main() {
  __setSmsClientForTests(fakeTwilioClient);

  const goodPhone = "519-555-7777";
  const PHI_NAME = "Johnathan Privacy-Smith";

  // (a) consent granted + valid phone -> ONE combined text listing ALL dates ---
  const granted = await makeClient("granted", goodPhone, PHI_NAME);
  await recordConsent(granted.id, true, false);
  const consentA = await checkSmsConsent(granted.id);
  assertEqual(consentA.hasConsent, true, "checkSmsConsent: granted -> true");

  sentMessages.length = 0;
  await svc.sendSeriesScheduledConfirmation(seriesData(granted.id, PHI_NAME));

  assertEqual(sentMessages.length, 1, "granted+phone: exactly ONE combined text sent (not one per date)");
  assertEqual(sentMessages[0]?.to, "+15195557777", "sent to normalized E.164 number");

  const body = sentMessages[0]?.body || "";
  // The combined body must list every booked date as a numbered line.
  const numberedLines = (body.match(/^\s*\d+\./gm) || []).length;
  assertEqual(numberedLines, SERIES_DATES.length, "body lists ALL series dates (one numbered line per date)");
  assertTrue(/recurring/i.test(body), "body says these are recurring appointment(s)");
  assertTrue(/STOP/i.test(body), "body includes STOP opt-out notice");
  assertTrue(!body.includes(PHI_NAME), "combined body is PHI-free (no client name)");

  const grantedRows = await smsAuditRows(granted.id);
  const sentRow = grantedRows.find((r) => r.action === "sms_notification_sent");
  assertTrue(!!sentRow, "audit logged: sms_notification_sent");
  assertEqual(sentRow?.result, "success", "sent audit row result = success");
  assertEqual(sentRow?.details?.series, true, "sent audit row marked series: true");
  assertEqual(sentRow?.details?.count, SERIES_DATES.length, "sent audit row records the series count");

  // (b) consent withdrawn -> NO text, blocked audit row (series:true) ----------
  const withdrawn = await makeClient("withdrawn", goodPhone, "Withdrawn Client");
  await recordConsent(withdrawn.id, true, true);
  const consentB = await checkSmsConsent(withdrawn.id);
  assertEqual(consentB.hasConsent, false, "checkSmsConsent: withdrawn -> false (fail-closed)");

  sentMessages.length = 0;
  await svc.sendSeriesScheduledConfirmation(seriesData(withdrawn.id, "Withdrawn Client"));
  assertEqual(sentMessages.length, 0, "withdrawn consent: NO series text sent");
  const withdrawnRows = await smsAuditRows(withdrawn.id);
  const withdrawnBlocked = withdrawnRows.find((r) => r.action === "sms_notification_blocked");
  assertTrue(!!withdrawnBlocked, "audit logged: sms_notification_blocked (withdrawn)");
  assertEqual(withdrawnBlocked?.details?.series, true, "withdrawn blocked audit row marked series: true");

  // (b2) no consent recorded at all -> NO text, blocked audit row --------------
  const none = await makeClient("none", goodPhone, "No Consent Client");
  const consentNone = await checkSmsConsent(none.id);
  assertEqual(consentNone.hasConsent, false, "checkSmsConsent: no record -> false (default off)");

  sentMessages.length = 0;
  await svc.sendSeriesScheduledConfirmation(seriesData(none.id, "No Consent Client"));
  assertEqual(sentMessages.length, 0, "no consent: NO series text sent");
  const noneRows = await smsAuditRows(none.id);
  const noneBlocked = noneRows.find((r) => r.action === "sms_notification_blocked");
  assertTrue(!!noneBlocked, "audit logged: sms_notification_blocked (no consent record)");
  assertEqual(noneBlocked?.details?.series, true, "no-consent blocked audit row marked series: true");

  // (c) consent granted + invalid phone -> NO text, blocked audit row ----------
  const badPhone = await makeClient("badphone", "12345", "Bad Phone Client");
  await recordConsent(badPhone.id, true, false);

  sentMessages.length = 0;
  await svc.sendSeriesScheduledConfirmation(seriesData(badPhone.id, "Bad Phone Client"));
  assertEqual(sentMessages.length, 0, "granted but invalid phone: NO series text sent");
  const badRows = await smsAuditRows(badPhone.id);
  const badBlocked = badRows.find((r) => r.action === "sms_notification_blocked");
  assertTrue(!!badBlocked, "audit logged: sms_notification_blocked (bad phone)");
  assertEqual(badBlocked?.details?.series, true, "bad-phone blocked audit row marked series: true");
}

main()
  .then(cleanup)
  .then(() => {
    console.log(`\nSMS series notification tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in SMS series notification test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });

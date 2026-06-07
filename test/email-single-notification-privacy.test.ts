/**
 * Automated tests for the SINGLE-appointment confirmation/reminder *EMAIL*
 * (SparkPost) audit trail.
 *
 * Task #159 added HIPAA audit rows for the recurring-*series* confirmation email
 * branch of `sendSeriesScheduledConfirmation`. This suite locks the much more
 * common SINGLE-appointment email paths in `sendEmailNotifications`, which
 * previously only logged send outcomes to the console / Communications tracking
 * notification and wrote NO audit row.
 *
 * Rules guarded here — every client-email OUTCOME writes exactly one audit row,
 * mirroring the SMS audit shape so both channels are queryable together:
 *   - SENT: an opted-in client with an email gets one `email_notification_sent`
 *     (result success) row.
 *   - FAILED: a provider send error gets one `email_notification_failed`
 *     (result failure) row.
 *   - BLOCKED (opted out): a client who opted out of email is filtered out of
 *     the recipient list before any send — recorded as `email_notification_blocked`.
 *   - BLOCKED (no email): a client with no email on file is likewise recorded
 *     as `email_notification_blocked` with the no-email reason.
 *   - SKIPPED (provider down): an opted-in client when SparkPost is not
 *     configured gets one `email_notification_skipped` row.
 * Details stay PHI-free (event type, reason, message id) — never the client name.
 *
 * This suite is hermetic: the SparkPost provider is stubbed at
 * `SparkPost.prototype.post` so no real email is sent and no cost is incurred.
 * Twilio is left UNCONFIGURED so the SMS branch is irrelevant.
 *
 * Run with: npx tsx test/email-single-notification-privacy.test.ts
 *
 * NOTES:
 * - DB-backed: seeds uniquely-keyed clients and removes everything it created
 *   at the end. Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md).
 */

// SparkPost + sender config must look configured so the email branch does real
// work; the actual network call is stubbed below, so the values are never used.
process.env.SPARKPOST_API_KEY = process.env.SPARKPOST_API_KEY || "test-sparkpost-key";
process.env.EMAIL_FROM = process.env.EMAIL_FROM || "schedule@example.test";

// Make sure Twilio looks UNCONFIGURED so the SMS branch is irrelevant.
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_FROM_NUMBER;

import SparkPost from "sparkpost";
import { db } from "../server/db";
import { clients, notifications, auditLogs } from "../shared/schema";
import { notificationService } from "../server/notification-service";
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

const SUFFIX = `emailsingle-${process.pid}-${Date.now()}`;
const createdClientIds: number[] = [];

// --- SparkPost stub: capture each send instead of hitting the network --------
type SentEmail = { to: string[]; subject: string; text: string };
const sentEmails: SentEmail[] = [];
let failNextSend = false;
const originalPost = (SparkPost.prototype as any).post;

function recipientEmails(options: any): string[] {
  const recips = options?.json?.recipients ?? [];
  return recips.map((r: any) =>
    typeof r?.address === "string" ? r.address : r?.address?.email,
  );
}

function installSparkPostStub() {
  (SparkPost.prototype as any).post = async function (options: any) {
    if (failNextSend) {
      throw new Error("simulated SparkPost transmission failure");
    }
    sentEmails.push({
      to: recipientEmails(options),
      subject: options?.json?.content?.subject ?? "",
      text: options?.json?.content?.text ?? "",
    });
    return { results: { id: `mock-${sentEmails.length}` } };
  };
}

function restoreSparkPostStub() {
  (SparkPost.prototype as any).post = originalPost;
}

function emailsTo(address: string): SentEmail[] {
  return sentEmails.filter((e) => e.to.includes(address));
}

// Every email-notification audit row written for a given client.
async function emailAuditsFor(clientId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.clientId, clientId),
        eq(auditLogs.resourceType, "email_notification"),
      ),
    );
}

async function makeClient(
  label: string,
  emailNotifications: boolean,
  withEmail = true,
) {
  const unique = `${process.pid}${Date.now() % 100000}`.slice(-13);
  const email = withEmail ? `${label}-${SUFFIX}@example.test` : null;
  const [client] = await db
    .insert(clients)
    .values({
      clientId: `CL-${unique}`.slice(0, 20),
      fullName: `${label} Single-Email`,
      email,
      emailNotifications,
      status: "active",
    } as any)
    .returning();
  createdClientIds.push(client.id);
  return client;
}

async function cleanup() {
  restoreSparkPostStub();
  if (createdClientIds.length > 0) {
    await db
      .delete(notifications)
      .where(inArray(notifications.relatedEntityId, createdClientIds));
    // Remove audit rows BEFORE the clients: audit_logs.client_id is ON DELETE
    // SET NULL, so once the client is gone the rows can't be found by clientId.
    await db
      .delete(auditLogs)
      .where(inArray(auditLogs.clientId, createdClientIds));
    await db.delete(clients).where(inArray(clients.id, createdClientIds));
  }
}

// A "session_scheduled" trigger that targets the session client.
function trigger() {
  return {
    id: 1,
    name: "Session Scheduled",
    eventType: "session_scheduled",
    isScheduled: false,
    priority: "normal",
    entityType: "session",
    recipientRules: JSON.stringify({ sessionClient: true }),
  } as any;
}

function entityData(clientId: number) {
  return {
    id: 9999,
    clientId,
    sessionDate: new Date("2026-07-01T15:00:00Z"),
    sessionType: "Individual Therapy",
    therapistName: "Dr. Test",
    duration: 60,
  };
}

// Build the client-as-User recipient object the same way getRecipients does,
// so a direct call to sendEmailNotifications matches the real flow.
function clientRecipient(client: any) {
  return {
    id: client.id,
    username: client.fullName,
    fullName: client.fullName,
    email: client.email,
    role: "client",
    isActive: true,
  } as any;
}

async function main() {
  installSparkPostStub();

  // (a) opted-in client + email present -> ONE email sent + ONE 'sent' row. ----
  const on = await makeClient("on", true);
  sentEmails.length = 0;
  failNextSend = false;
  await svc.sendEmailNotifications([clientRecipient(on)], trigger(), null, entityData(on.id));

  assertEqual(emailsTo(on.email!).length, 1, "opted-in client: exactly ONE email sent");
  const onAudits = await emailAuditsFor(on.id);
  assertEqual(onAudits.length, 1, "opted-in client: exactly ONE audit row");
  assertEqual(onAudits[0]?.action, "email_notification_sent", "sent email uses email_notification_sent action");
  assertEqual(onAudits[0]?.result, "success", "sent email audit row has result 'success'");
  assertEqual(onAudits[0]?.resourceType, "email_notification", "sent audit row resourceType is email_notification");
  assertTrue(!!onAudits[0]?.hipaaRelevant, "sent email audit row is flagged HIPAA-relevant");
  const onDetails = JSON.parse(onAudits[0]?.details || "{}");
  assertEqual(onDetails.eventType, "session_scheduled", "sent audit details carry the event type");
  assertTrue(!!onDetails.messageId, "sent audit details carry the provider message id");
  assertTrue(!/On Single-Email/.test(onAudits[0]?.details || ""), "sent audit details are PHI-free (no client name)");

  // (b) opted-in client + provider send fails -> ONE 'failed' row. ------------
  const fail = await makeClient("fail", true);
  sentEmails.length = 0;
  failNextSend = true;
  await svc.sendEmailNotifications([clientRecipient(fail)], trigger(), null, entityData(fail.id));
  failNextSend = false;

  assertEqual(emailsTo(fail.email!).length, 0, "failed send: no email captured");
  const failAudits = await emailAuditsFor(fail.id);
  assertEqual(failAudits.length, 1, "failed send: exactly ONE audit row");
  assertEqual(failAudits[0]?.action, "email_notification_failed", "failed send uses email_notification_failed action");
  assertEqual(failAudits[0]?.result, "failure", "failed send audit row has result 'failure'");
  const failDetails = JSON.parse(failAudits[0]?.details || "{}");
  assertTrue(typeof failDetails.error === "string" && failDetails.error.length > 0, "failed send audit records an error reason");

  // (c) opted-OUT client -> filtered from recipients -> ONE 'blocked' row. ----
  const off = await makeClient("off", false);
  sentEmails.length = 0;
  failNextSend = false;
  // getRecipients would NOT add this client (emailNotifications=false), so the
  // recipient list is empty — exactly what sendEmailNotifications receives.
  await svc.sendEmailNotifications([], trigger(), null, entityData(off.id));

  assertEqual(emailsTo(off.email!).length, 0, "opted-out client: NO email sent");
  const offAudits = await emailAuditsFor(off.id);
  assertEqual(offAudits.length, 1, "opted-out client: exactly ONE audit row");
  assertEqual(offAudits[0]?.action, "email_notification_blocked", "opted-out client uses email_notification_blocked action");
  assertEqual(offAudits[0]?.result, "blocked", "opted-out client audit row has result 'blocked'");
  const offDetails = JSON.parse(offAudits[0]?.details || "{}");
  assertTrue(/opted out/i.test(offDetails.reason || ""), "opted-out client audit records the opt-out reason");
  assertTrue(!/Off Single-Email/.test(offAudits[0]?.details || ""), "opted-out audit details are PHI-free (no client name)");

  // (d) client with NO email on file -> ONE 'blocked' row, no-email reason. ----
  const noemail = await makeClient("noemail", true, false);
  sentEmails.length = 0;
  await svc.sendEmailNotifications([], trigger(), null, entityData(noemail.id));

  const noemailAudits = await emailAuditsFor(noemail.id);
  assertEqual(noemailAudits.length, 1, "no-email client: exactly ONE audit row");
  assertEqual(noemailAudits[0]?.action, "email_notification_blocked", "no-email client uses email_notification_blocked action");
  const noemailDetails = JSON.parse(noemailAudits[0]?.details || "{}");
  assertTrue(/no email/i.test(noemailDetails.reason || ""), "no-email client audit records the no-email reason");

  // (e) opted-in client + provider NOT configured -> ONE 'skipped' row. -------
  const skip = await makeClient("skip", true);
  sentEmails.length = 0;
  const savedKey = process.env.SPARKPOST_API_KEY;
  delete process.env.SPARKPOST_API_KEY;
  await svc.sendEmailNotifications([clientRecipient(skip)], trigger(), null, entityData(skip.id));
  process.env.SPARKPOST_API_KEY = savedKey;

  assertEqual(emailsTo(skip.email!).length, 0, "provider down: NO email sent");
  const skipAudits = await emailAuditsFor(skip.id);
  assertEqual(skipAudits.length, 1, "provider down: exactly ONE audit row");
  assertEqual(skipAudits[0]?.action, "email_notification_skipped", "provider down uses email_notification_skipped action");
  const skipDetails = JSON.parse(skipAudits[0]?.details || "{}");
  assertTrue(/not configured/i.test(skipDetails.reason || ""), "provider-down audit records the provider-not-configured reason");
}

main()
  .then(cleanup)
  .then(() => {
    console.log(`\nEmail single notification tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in email single notification test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });

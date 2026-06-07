/**
 * Automated tests for the recurring-series confirmation *EMAIL* (SparkPost).
 *
 * When a recurring series of appointments is booked, the client must receive a
 * single confirmation email that lists EVERY booked date. Task #157 locked the
 * sibling SMS path of `sendSeriesScheduledConfirmation`; this hermetic suite
 * does the same for the email branch in the same method, so an email regression
 * can't slip through unnoticed.
 *
 * Rules guarded here:
 *   - PREFERENCE GATE: the email respects the client's email-notification
 *     preference. A client with emailNotifications = false (or no email on
 *     file) gets NO email — mirrors the fail-closed SMS style.
 *   - COMPLETENESS: a consenting client's email body lists every booked date
 *     (one numbered line per date).
 *   - SKIPPED NOTE: when `skippedCount > 0`, the body includes the
 *     "X requested date(s) were not booked …" conflict note; when there are no
 *     skips, that note is absent.
 *
 * This suite is hermetic: the SparkPost provider is stubbed at
 * `SparkPost.prototype.post` (the single method `transmissions.send` funnels
 * through), so no real email is sent and no cost is incurred. Twilio is left
 * UNCONFIGURED so the SMS branch is skipped and only the email branch runs.
 *
 * Run with: npx tsx test/email-series-notification-privacy.test.ts
 *
 * NOTES:
 * - DB-backed: seeds uniquely-keyed clients and removes everything it created
 *   (clients + any notifications tracked against them) at the end. Must run
 *   serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md).
 */

// SparkPost + sender config must look configured so the email branch does real
// work; the actual network call is stubbed below, so the values are never used.
process.env.SPARKPOST_API_KEY = process.env.SPARKPOST_API_KEY || "test-sparkpost-key";
process.env.EMAIL_FROM = process.env.EMAIL_FROM || "schedule@example.test";

// Deliberately make sure Twilio looks UNCONFIGURED so isSmsConfigured() is
// false and the SMS branch is skipped — this suite only exercises the email
// branch. (tsx runs each test file in its own process, so this is isolated.)
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_FROM_NUMBER;

import SparkPost from "sparkpost";
import { db } from "../server/db";
import { clients, notifications } from "../shared/schema";
import { notificationService } from "../server/notification-service";
import { eq, inArray } from "drizzle-orm";

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

const SUFFIX = `emailseries-${process.pid}-${Date.now()}`;
const createdClientIds: number[] = [];

// --- SparkPost stub: capture each send instead of hitting the network --------
// transmissions.send() funnels through SparkPost.prototype.post(options), where
// options.json holds { content: { text, html, subject }, recipients }.
type SentEmail = { to: string[]; subject: string; text: string };
const sentEmails: SentEmail[] = [];
const originalPost = (SparkPost.prototype as any).post;

function recipientEmails(options: any): string[] {
  const recips = options?.json?.recipients ?? [];
  return recips.map((r: any) =>
    typeof r?.address === "string" ? r.address : r?.address?.email,
  );
}

function installSparkPostStub() {
  (SparkPost.prototype as any).post = async function (options: any) {
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

// All emails captured for a specific recipient address.
function emailsTo(address: string): SentEmail[] {
  return sentEmails.filter((e) => e.to.includes(address));
}

async function makeClient(label: string, emailNotifications: boolean) {
  const unique = `${process.pid}${Date.now() % 100000}`.slice(-13);
  const email = `${label}-${SUFFIX}@example.test`;
  const [client] = await db
    .insert(clients)
    .values({
      clientId: `CL-${unique}`.slice(0, 20),
      fullName: `${label} Series-Email`,
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
    // The series path writes a system-user tracking notification keyed to the
    // client (relatedEntityType 'client') plus a therapist in-app notification
    // (relatedEntityType 'session', relatedEntityId = clientId). Remove both.
    await db
      .delete(notifications)
      .where(inArray(notifications.relatedEntityId, createdClientIds));
    await db.delete(clients).where(inArray(clients.id, createdClientIds));
  }
}

// Three booked dates for the recurring series.
const SERIES_DATES = [
  new Date("2026-07-01T15:00:00Z"),
  new Date("2026-07-08T15:00:00Z"),
  new Date("2026-07-15T15:00:00Z"),
];

function seriesData(clientId: number, clientName: string, skippedCount?: number) {
  return {
    clientId,
    therapistId: 6, // SYSTEM_USER_ID exists; safe FK for the in-app notification
    clientName,
    therapistName: "Dr. Test",
    serviceName: "Therapy",
    roomName: "Room 1",
    sessionDates: SERIES_DATES,
    skippedCount,
  };
}

async function main() {
  installSparkPostStub();

  // (a) emailNotifications ON + skippedCount > 0 -> ONE email listing ALL dates
  //     and including the skipped-conflict note. ------------------------------
  const on = await makeClient("on", true);
  sentEmails.length = 0;
  await svc.sendSeriesScheduledConfirmation(seriesData(on.id, "On Client", 2));

  const onEmails = emailsTo(on.email);
  assertEqual(onEmails.length, 1, "emailNotifications on: exactly ONE series email sent");

  const body = onEmails[0]?.text || "";
  // The combined body must list every booked date as a numbered line.
  const numberedLines = (body.match(/^\s*\d+\./gm) || []).length;
  assertEqual(numberedLines, SERIES_DATES.length, "email body lists ALL series dates (one numbered line per date)");
  assertTrue(/recurring/i.test(body), "email body mentions recurring appointments");
  assertTrue(
    /2 requested date\(s\) were not booked/.test(body),
    "email body includes the skipped-conflict note when skippedCount > 0",
  );
  assertTrue(
    /Your 3 recurring appointments are confirmed/.test(onEmails[0]?.subject || ""),
    "email subject reports the booked count",
  );

  // (a2) emailNotifications ON + skippedCount = 0 -> email sent, NO skip note. -
  const onNoSkip = await makeClient("onnoskip", true);
  sentEmails.length = 0;
  await svc.sendSeriesScheduledConfirmation(seriesData(onNoSkip.id, "On NoSkip", 0));

  const noSkipEmails = emailsTo(onNoSkip.email);
  assertEqual(noSkipEmails.length, 1, "no skips: ONE series email sent");
  const noSkipBody = noSkipEmails[0]?.text || "";
  assertEqual(
    (noSkipBody.match(/^\s*\d+\./gm) || []).length,
    SERIES_DATES.length,
    "no-skip email still lists ALL series dates",
  );
  assertTrue(
    !/were not booked/.test(noSkipBody),
    "no-skip email omits the skipped-conflict note",
  );

  // (b) emailNotifications OFF -> NO email sent (fail-closed on preference). ---
  const off = await makeClient("off", false);
  sentEmails.length = 0;
  await svc.sendSeriesScheduledConfirmation(seriesData(off.id, "Off Client", 2));
  assertEqual(emailsTo(off.email).length, 0, "emailNotifications off: NO series email sent");
}

main()
  .then(cleanup)
  .then(() => {
    console.log(`\nEmail series notification tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in email series notification test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });

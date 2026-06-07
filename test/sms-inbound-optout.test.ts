/**
 * Automated tests for INBOUND SMS opt-out / opt-in (Twilio webhook).
 *
 * Clients can reply STOP to any appointment text to opt out, and START to opt
 * back in. Twilio delivers those replies to POST /api/sms/inbound. This suite
 * proves:
 *   1. classifyInboundSms — STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT -> opt-out,
 *      START/UNSTOP/YES -> opt-in, anything else -> null (case/punct-insensitive,
 *      and a sentence merely containing "stop" does NOT opt out).
 *   2. validateTwilioSignature — a forged/unsigned request is rejected; a
 *      correctly-signed request passes.
 *   3. The webhook end-to-end (real Express app, real DB):
 *      a. unsigned/forged request -> 403, consent UNCHANGED.
 *      b. signed "STOP" -> client's sms_notifications consent withdrawn,
 *         checkSmsConsent() now false, a 'consent_withdrawn' audit row written.
 *      c. signed "START" -> consent re-granted, checkSmsConsent() true again,
 *         a 'consent_granted' audit row written.
 *      d. signed "STOP" from a number with NO matching client -> 200, no crash.
 *
 * Hermetic: no network/credentials. Twilio signature is computed locally with a
 * fixed test auth token. DB-backed: seeds a uniquely-keyed client + consents and
 * removes everything it created at the end. Must run serially with the other
 * app-level tests (see .agents/memory/privacy-test-concurrency.md).
 *
 * Run with: npx tsx test/sms-inbound-optout.test.ts
 */

// A fixed auth token so we can compute valid Twilio signatures locally. The
// from-number/sid just need to be present so isSmsConfigured() is true.
process.env.TWILIO_ACCOUNT_SID = "AC_test_sid_inbound";
process.env.TWILIO_AUTH_TOKEN = "inbound_test_token";
process.env.TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "+15005550006";

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import twilio from "twilio";
import { db } from "../server/db";
import { clients, patientConsents, auditLogs } from "../shared/schema";
import { storage } from "../server/storage";
import { checkSmsConsent } from "../server/routes-helpers";
import { classifyInboundSms, validateTwilioSignature } from "../server/sms-service";
import { eq, and, inArray } from "drizzle-orm";

let registerRoutes: typeof import("../server/routes")["registerRoutes"];

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

const SUFFIX = `smsin-${process.pid}-${Date.now()}`;
const createdClientIds: number[] = [];
const CLIENT_PHONE = "519-555-8888";
const CLIENT_E164 = "+15195558888";

let baseUrl = "";

async function makeClient(): Promise<number> {
  const unique = `${process.pid}${Date.now() % 100000}`.slice(-13);
  const [client] = await db
    .insert(clients)
    .values({
      clientId: `CL-${unique}`.slice(0, 20),
      fullName: "Inbound Optout Client",
      email: `${SUFFIX}@example.test`,
      phone: CLIENT_PHONE,
      status: "active",
    } as any)
    .returning();
  createdClientIds.push(client.id);
  return client.id;
}

async function grantConsent(clientId: number) {
  await storage.createClientConsent({
    clientId,
    consentType: "sms_notifications",
    granted: true,
    consentVersion: "1.0.0",
    ipAddress: "",
    userAgent: "",
    notes: "test seed granted",
  } as any);
}

// POST a Twilio-style form body to the webhook with a (optionally valid) signature.
async function postInbound(params: Record<string, string>, sign: boolean) {
  const url = `${baseUrl}/api/sms/inbound`;
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (sign) {
    headers["X-Twilio-Signature"] = twilio.getExpectedTwilioSignature(
      process.env.TWILIO_AUTH_TOKEN as string,
      url,
      params,
    );
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: new URLSearchParams(params).toString(),
  });
  return res.status;
}

async function consentAuditActions(clientId: number): Promise<string[]> {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, "patient_consent"),
        eq(auditLogs.clientId, clientId),
      ),
    );
  return rows.map((r) => r.action as string);
}

async function cleanup() {
  if (createdClientIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, "patient_consent"),
          inArray(auditLogs.clientId, createdClientIds),
        ),
      );
    await db
      .delete(patientConsents)
      .where(inArray(patientConsents.clientId, createdClientIds));
    await db.delete(clients).where(inArray(clients.id, createdClientIds));
  }
}

async function main() {
  // --- 1. classifyInboundSms (pure) -----------------------------------------
  assertEqual(classifyInboundSms("STOP"), "opt-out", "STOP -> opt-out");
  assertEqual(classifyInboundSms(" stop "), "opt-out", "lowercase/whitespace stop -> opt-out");
  assertEqual(classifyInboundSms("Stop."), "opt-out", "trailing punctuation stop -> opt-out");
  assertEqual(classifyInboundSms("STOPALL"), "opt-out", "STOPALL -> opt-out");
  assertEqual(classifyInboundSms("Unsubscribe"), "opt-out", "UNSUBSCRIBE -> opt-out");
  assertEqual(classifyInboundSms("CANCEL"), "opt-out", "CANCEL -> opt-out");
  assertEqual(classifyInboundSms("START"), "opt-in", "START -> opt-in");
  assertEqual(classifyInboundSms("unstop"), "opt-in", "UNSTOP -> opt-in");
  assertEqual(classifyInboundSms("YES"), "opt-in", "YES -> opt-in");
  assertEqual(classifyInboundSms("please stop texting me"), null, "sentence containing 'stop' -> null (no accidental opt-out)");
  assertEqual(classifyInboundSms("hello"), null, "unrelated word -> null");
  assertEqual(classifyInboundSms(""), null, "empty -> null");
  assertEqual(classifyInboundSms(null), null, "null -> null");

  // --- 2. validateTwilioSignature (pure) ------------------------------------
  const sigUrl = "https://example.test/api/sms/inbound";
  const sigParams = { From: CLIENT_E164, Body: "STOP" };
  const goodSig = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN as string,
    sigUrl,
    sigParams,
  );
  assertEqual(validateTwilioSignature(goodSig, sigUrl, sigParams), true, "valid signature accepted");
  assertEqual(validateTwilioSignature("bogus", sigUrl, sigParams), false, "forged signature rejected");
  assertEqual(validateTwilioSignature(undefined, sigUrl, sigParams), false, "missing signature rejected");

  // --- 3. webhook end-to-end -------------------------------------------------
  const clientId = await makeClient();
  await grantConsent(clientId);
  assertEqual((await checkSmsConsent(clientId)).hasConsent, true, "precondition: consent granted");

  // (a) unsigned/forged request -> 403, consent unchanged.
  const forgedStatus = await postInbound({ From: CLIENT_E164, Body: "STOP" }, false);
  assertEqual(forgedStatus, 403, "unsigned STOP -> 403 rejected");
  assertEqual((await checkSmsConsent(clientId)).hasConsent, true, "consent UNCHANGED after rejected request");

  // (b) signed STOP -> consent withdrawn + audited.
  const stopStatus = await postInbound({ From: CLIENT_E164, Body: "STOP" }, true);
  assertEqual(stopStatus, 200, "signed STOP -> 200");
  assertEqual((await checkSmsConsent(clientId)).hasConsent, false, "signed STOP withdraws SMS consent");
  assertTrue((await consentAuditActions(clientId)).includes("consent_withdrawn"), "audit logged: consent_withdrawn");

  // (c) signed START -> consent re-granted + audited.
  const startStatus = await postInbound({ From: CLIENT_E164, Body: "Start" }, true);
  assertEqual(startStatus, 200, "signed START -> 200");
  assertEqual((await checkSmsConsent(clientId)).hasConsent, true, "signed START re-grants SMS consent");
  assertTrue((await consentAuditActions(clientId)).includes("consent_granted"), "audit logged: consent_granted");

  // (d) signed STOP from an unknown number -> 200, no crash.
  const unknownStatus = await postInbound({ From: "+15005550000", Body: "STOP" }, true);
  assertEqual(unknownStatus, 200, "STOP from unknown number -> 200 (ignored, no crash)");
}

async function run() {
  ({ registerRoutes } = await import("../server/routes"));
  let server: Server | null = null;
  try {
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: false, limit: "50mb" }));
    app.use(cookieParser());
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    // The webhook computes the signed URL from the request; pin it so the
    // locally-computed signature matches exactly.
    process.env.BASE_URL = baseUrl;
    console.log(`   Test server listening on ${baseUrl}\n`);

    await main();
  } finally {
    await cleanup().catch(() => {});
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}

run()
  .then(() => {
    console.log(`\nInbound SMS opt-out tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in inbound SMS test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });

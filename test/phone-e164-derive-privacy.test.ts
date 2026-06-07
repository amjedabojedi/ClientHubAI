/**
 * Tests for the standardized SMS phone copy (`phoneE164`).
 *
 * Task #156 adds a SEPARATE, auto-derived E.164 copy of each typed phone number,
 * used only for texting. The typed `phone` is NEVER modified. This suite proves:
 *   1. normalizePhoneE164 (pure, shared) — NANP 10/11-digit, +international, junk.
 *   2. storage.createClient / createUser derive phoneE164 from the typed phone.
 *   3. storage.updateClient / updateUser recompute phoneE164 ONLY when `phone`
 *      is part of the update, clear it when the new number can't be standardized,
 *      leave it untouched when the update doesn't include `phone`, and never
 *      alter the typed `phone` itself.
 *
 * Run with: npx tsx test/phone-e164-derive-privacy.test.ts
 *
 * NOTES:
 * - DB-backed: seeds uniquely-keyed clients/users and removes them at the end.
 *   Must run serially with the other app-level tests
 *   (see .agents/memory/privacy-test-concurrency.md).
 */

import { db } from "../server/db";
import { clients, users } from "../shared/schema";
import { storage } from "../server/storage";
import { normalizePhoneE164 } from "@shared/phone";
import { inArray } from "drizzle-orm";

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

const SUFFIX = `phe-${process.pid}-${Date.now()}`;
const createdClientIds: number[] = [];
const createdUserIds: number[] = [];

async function cleanup() {
  if (createdClientIds.length) {
    await db.delete(clients).where(inArray(clients.id, createdClientIds)).catch(() => {});
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds)).catch(() => {});
  }
}

function testPureNormalize() {
  assertEqual(normalizePhoneE164("5195551234"), "+15195551234", "pure: NANP 10-digit -> +1");
  assertEqual(normalizePhoneE164("15195551234"), "+15195551234", "pure: 11-digit leading 1 -> +1");
  assertEqual(normalizePhoneE164("(519) 555-1234"), "+15195551234", "pure: formatted NANP -> +1");
  assertEqual(normalizePhoneE164("+44 20 7946 0958"), "+442079460958", "pure: international + kept");
  assertEqual(normalizePhoneE164("12345"), null, "pure: too short -> null");
  assertEqual(normalizePhoneE164(""), null, "pure: empty -> null");
  assertEqual(normalizePhoneE164(null), null, "pure: null -> null");
  assertEqual(normalizePhoneE164("abc"), null, "pure: junk -> null");
}

async function testClientDerive() {
  // create with a good number -> derived
  const c1 = await storage.createClient({ fullName: `Good ${SUFFIX}`, phone: "519-555-1234" } as any);
  createdClientIds.push(c1.id);
  assertEqual(c1.phone, "519-555-1234", "client create: typed phone kept verbatim");
  assertEqual(c1.phoneE164, "+15195551234", "client create: phoneE164 derived");

  // create with junk -> phoneE164 null, typed kept
  const c2 = await storage.createClient({ fullName: `Junk ${SUFFIX}`, phone: "12345" } as any);
  createdClientIds.push(c2.id);
  assertEqual(c2.phone, "12345", "client create(junk): typed phone kept verbatim");
  assertEqual(c2.phoneE164, null, "client create(junk): phoneE164 null");

  // update changing phone -> recompute; typed kept verbatim
  const c1b = await storage.updateClient(c1.id, { phone: "(416) 555-9876" } as any);
  assertEqual(c1b.phone, "(416) 555-9876", "client update(phone): typed kept verbatim");
  assertEqual(c1b.phoneE164, "+14165559876", "client update(phone): phoneE164 recomputed");

  // update changing phone to junk -> phoneE164 cleared to null
  const c1c = await storage.updateClient(c1.id, { phone: "nope" } as any);
  assertEqual(c1c.phone, "nope", "client update(junk phone): typed kept verbatim");
  assertEqual(c1c.phoneE164, null, "client update(junk phone): phoneE164 cleared");

  // update NOT touching phone -> phoneE164 untouched
  const c2b = await storage.updateClient(c2.id, { phone: "519-555-0000" } as any);
  assertEqual(c2b.phoneE164, "+15195550000", "client update: set a valid number first");
  const c2c = await storage.updateClient(c2.id, { city: "Toronto" } as any);
  assertEqual(c2c.phoneE164, "+15195550000", "client update(no phone key): phoneE164 untouched");

  // update with phone: undefined -> NOT treated as a change, phoneE164 untouched
  const c2d = await storage.updateClient(c2.id, { phone: undefined, city: "Ottawa" } as any);
  assertEqual(c2d.phone, "519-555-0000", "client update(phone undefined): typed phone untouched");
  assertEqual(c2d.phoneE164, "+15195550000", "client update(phone undefined): phoneE164 untouched");

  // update with explicit null -> a real clear, phoneE164 cleared
  const c2e = await storage.updateClient(c2.id, { phone: null } as any);
  assertEqual(c2e.phone, null, "client update(phone null): typed phone cleared");
  assertEqual(c2e.phoneE164, null, "client update(phone null): phoneE164 cleared");
}

async function testUserDerive() {
  const u1 = await storage.createUser({
    username: `good-${SUFFIX}`,
    password: "x",
    fullName: `Good User ${SUFFIX}`,
    email: `good-${SUFFIX}@example.test`,
    role: "therapist",
    phone: "519-555-2222",
  } as any);
  createdUserIds.push(u1.id);
  assertEqual(u1.phone, "519-555-2222", "user create: typed phone kept verbatim");
  assertEqual(u1.phoneE164, "+15195552222", "user create: phoneE164 derived");

  // update not touching phone -> untouched
  const u1b = await storage.updateUser(u1.id, { title: "Dr." } as any);
  assertEqual(u1b.phoneE164, "+15195552222", "user update(no phone key): phoneE164 untouched");

  // update phone to junk -> cleared
  const u1c = await storage.updateUser(u1.id, { phone: "x" } as any);
  assertEqual(u1c.phone, "x", "user update(junk phone): typed kept verbatim");
  assertEqual(u1c.phoneE164, null, "user update(junk phone): phoneE164 cleared");
}

async function main() {
  testPureNormalize();
  await testClientDerive();
  await testUserDerive();
}

main()
  .then(cleanup)
  .then(() => {
    console.log(`\nphoneE164 derive tests: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Fatal error in phoneE164 derive test:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });

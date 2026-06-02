/**
 * Automated Tests for the Daily Schedule Email OPT-OUT preference — via the
 * REAL HTTP API a therapist actually uses.
 *
 * A sibling suite (test/daily-schedule-email-preference.test.ts) proves the
 * daily-send loop honors a `daily_schedule_email` preference by writing the
 * notificationPreferences row directly. THIS suite closes the remaining gap:
 * it drives the preference through the same notification-preferences HTTP API
 * the settings screen calls, then runs the daily send and asserts the toggle
 * was actually persisted and honored. A regression in the route, its auth, or
 * its request validation could let a "disabled" toggle silently fail to
 * persist — the UI would show the therapist opted out while emails keep
 * arriving. Exercising the wire path catches that.
 *
 * Cases covered (all for the SAME therapist, in order, to mirror real usage):
 *   1. DISABLE via API  — PUT /api/notifications/preferences/daily_schedule_email
 *      with email off ⇒ the next daily run SKIPS them (no email sent), and a
 *      GET reflects the persisted opt-out.
 *   2. RE-ENABLE via API — PUT the same endpoint with email on ⇒ the next daily
 *      run DOES email them.
 *
 * The app is assembled in-process with the exact production middleware chain
 * (express.json → cookieParser → optionalAuth → /api CSRF guard →
 * notificationRoutes) and listens on an ephemeral port, so the requests go over
 * real HTTP through requireAuth, CSRF, and Zod validation — not a function call.
 * Auth uses a genuine session token minted by createSessionToken (exactly what
 * /api/auth/login issues on success) plus a matching CSRF cookie/header pair.
 *
 * The SparkPost provider is stubbed at `SparkPost.prototype.post` so no real
 * email is sent and no cost is incurred. Stubbing per-recipient isolates OUR
 * test therapist from any other therapists in the shared dev DB.
 *
 * Run with: npx tsx test/daily-schedule-email-preference-api.test.ts
 *
 * NOTES:
 * - DB-backed: seeds a dedicated, uniquely-named therapist and removes it (and
 *   every daily_schedule_emails / notification_preferences row created on the
 *   test dates / for the test user) at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md); it is chained into the
 *   `test-privacy` validation.
 */

// Provider + sender config must be present so processDailyScheduleEmails does
// real work; the actual network call is stubbed below, so the values are fake.
process.env.SPARKPOST_API_KEY = process.env.SPARKPOST_API_KEY || "test-sparkpost-key";
process.env.EMAIL_FROM = process.env.EMAIL_FROM || "schedule@example.test";

import express from "express";
import cookieParser from "cookie-parser";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import SparkPost from "sparkpost";
import { db } from "../server/db";
import { users, dailyScheduleEmails, notificationPreferences } from "../shared/schema";
import { storage } from "../server/storage";
import { notificationService } from "../server/notification-service";
import notificationRoutes from "../server/notification-routes";
import {
  createSessionToken,
  optionalAuth,
  csrfProtection,
} from "../server/auth-middleware";
import { eq, inArray } from "drizzle-orm";

// Must match DAILY_SCHEDULE_EMAIL_TRIGGER in server/notification-service.ts.
const DAILY_SCHEDULE_EMAIL_TRIGGER = "daily_schedule_email";

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

const SUFFIX = `dsepref-api-${Date.now()}`;
const createdUserIds: number[] = [];
const testDates: string[] = [];

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
    const emails = recipientEmails(options);
    for (const email of emails) {
      postCallsByEmail.set(email, (postCallsByEmail.get(email) ?? 0) + 1);
    }
    return { results: { id: `mock-${Date.now()}` } };
  };
}

function restoreSparkPostStub() {
  (SparkPost.prototype as any).post = originalPost;
}

function callsFor(email: string): number {
  return postCallsByEmail.get(email) ?? 0;
}

// ---------------------------------------------------------------------------
// In-process app mirroring the production middleware chain (server/index.ts).
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: false, limit: "50mb" }));
  app.use(cookieParser());
  app.use(optionalAuth);
  // CSRF guard for /api, matching server/index.ts (no public path applies here).
  app.use("/api", (req, res, next) => csrfProtection(req as any, res, next));
  app.use("/api/notifications", notificationRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

async function startServer() {
  const app = buildApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer() {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
}

// Authenticated fetch helper: presents a genuine session token plus a matching
// CSRF cookie/header pair, exactly like a logged-in browser session.
const CSRF_TOKEN = "test-csrf-token";
function authHeaders(token: string) {
  return {
    "content-type": "application/json",
    "x-csrf-token": CSRF_TOKEN,
    cookie: `sessionToken=${token}; csrfToken=${CSRF_TOKEN}`,
  };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function makeTherapist(label: string) {
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

// Per-process-unique, far-future Eastern dates. These must be unique not just
// vs. real data but vs. any OTHER concurrent instance of this suite (the
// workflow and a validation trigger can run it twice at once — see
// .agents/memory/privacy-test-concurrency.md). A random offset across a large
// future window makes cross-run date collisions effectively impossible, so one
// run's cleanup-by-date can never delete another run's rows.
const PROC_DATE_OFFSET =
  (process.pid * 31 + Math.floor(Math.random() * 50000)) % 50000;
let dateCounter = 0;
function nextTestDate(): string {
  const base = new Date(Date.UTC(2050, 0, 1));
  base.setUTCDate(base.getUTCDate() + PROC_DATE_OFFSET + dateCounter++);
  const d = base.toISOString().slice(0, 10);
  testDates.push(d);
  return d;
}

// ---------------------------------------------------------------------------
async function main() {
  installSparkPostStub();
  await startServer();

  try {
    const t = await makeTherapist("api-therapist");
    const token = createSessionToken({
      id: t.id,
      username: t.username,
      role: t.role,
    });

    // -------------------------------------------------------------------
    // Test 1: DISABLE the digest through the HTTP API → NOT emailed.
    // -------------------------------------------------------------------
    {
      const disableRes = await fetch(
        `${baseUrl}/api/notifications/preferences/${DAILY_SCHEDULE_EMAIL_TRIGGER}`,
        {
          method: "PUT",
          headers: authHeaders(token),
          body: JSON.stringify({
            deliveryMethods: JSON.stringify(["in_app"]),
            enableInApp: true,
            enableEmail: false,
            enableSms: false,
          }),
        },
      );
      assertEqual(
        disableRes.status,
        200,
        "PUT preferences (disable email) returns 200",
      );

      // GET should reflect the persisted opt-out.
      const getRes = await fetch(`${baseUrl}/api/notifications/preferences`, {
        headers: authHeaders(token),
      });
      assertEqual(getRes.status, 200, "GET preferences returns 200");
      const prefs = (await getRes.json()) as any[];
      const saved = prefs.find(
        (p) => p.triggerType === DAILY_SCHEDULE_EMAIL_TRIGGER,
      );
      assertEqual(
        saved?.enableEmail,
        false,
        "Persisted preference shows email disabled after API disable",
      );

      const date = nextTestDate();
      await notificationService.processDailyScheduleEmails(date);
      assertEqual(
        callsFor(t.email),
        0,
        "Therapist who disabled the digest via API is NOT emailed",
      );
    }

    // -------------------------------------------------------------------
    // Test 2: RE-ENABLE the digest through the HTTP API → IS emailed.
    // -------------------------------------------------------------------
    {
      const enableRes = await fetch(
        `${baseUrl}/api/notifications/preferences/${DAILY_SCHEDULE_EMAIL_TRIGGER}`,
        {
          method: "PUT",
          headers: authHeaders(token),
          body: JSON.stringify({
            deliveryMethods: JSON.stringify(["in_app", "email"]),
            enableInApp: true,
            enableEmail: true,
            enableSms: false,
          }),
        },
      );
      assertEqual(
        enableRes.status,
        200,
        "PUT preferences (re-enable email) returns 200",
      );

      const getRes = await fetch(`${baseUrl}/api/notifications/preferences`, {
        headers: authHeaders(token),
      });
      const prefs = (await getRes.json()) as any[];
      const saved = prefs.find(
        (p) => p.triggerType === DAILY_SCHEDULE_EMAIL_TRIGGER,
      );
      assertEqual(
        saved?.enableEmail,
        true,
        "Persisted preference shows email enabled after API re-enable",
      );

      const date = nextTestDate();
      await notificationService.processDailyScheduleEmails(date);
      assertEqual(
        callsFor(t.email),
        1,
        "Therapist who re-enabled the digest via API IS emailed",
      );
    }

    // -------------------------------------------------------------------
    // Test 3: the API rejects callers with no session (no silent persist).
    // A valid CSRF pair is supplied so the request clears the CSRF guard and
    // we isolate the auth check: requireAuth must reject the missing session.
    // -------------------------------------------------------------------
    {
      const res = await fetch(
        `${baseUrl}/api/notifications/preferences/${DAILY_SCHEDULE_EMAIL_TRIGGER}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": CSRF_TOKEN,
            cookie: `csrfToken=${CSRF_TOKEN}`,
          },
          body: JSON.stringify({ enableEmail: false }),
        },
      );
      assertEqual(
        res.status,
        401,
        "PUT preferences without a session is rejected (401)",
      );
    }
  } finally {
    restoreSparkPostStub();
    await stopServer();
    // Cleanup: remove every daily_schedule_emails row on our test dates, our
    // notification_preferences rows, then our users.
    try {
      if (testDates.length > 0) {
        await db
          .delete(dailyScheduleEmails)
          .where(inArray(dailyScheduleEmails.sendDate, testDates));
      }
      if (createdUserIds.length > 0) {
        await db
          .delete(notificationPreferences)
          .where(inArray(notificationPreferences.userId, createdUserIds));
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

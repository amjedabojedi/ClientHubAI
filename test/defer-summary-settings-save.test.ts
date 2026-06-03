/**
 * Automated Test: the staff Notifications settings screen actually SAVES the
 * account-wide "Send a catch-up summary" toggle (`quietHoursDeferToSummary`).
 *
 * Task #54 added test/quiet-hours-settings-save.test.ts proving the quiet-hours
 * window + weekend toggle save through the real settings-screen endpoint. But
 * the sibling "Send a catch-up summary" toggle on that SAME screen — which
 * writes the SAME reserved "__global__" notificationPreferences row via the
 * SAME save endpoint — was never covered. A regression (wrong field key, a
 * partial update that clobbers the quiet-hours window, or the toggle simply not
 * persisting) could leave staff thinking paused emails will be consolidated
 * into one catch-up summary when nothing was saved — the same trust gap the
 * quiet-hours save test closes.
 *
 * This suite drives the REAL save endpoint the UI calls
 * (`PUT /api/notifications/preferences/__global__`) over HTTP, with the EXACT
 * request body the settings screen builds (see
 * client/src/pages/notifications.tsx ~line 1377:
 * `{ quietHoursDeferToSummary: checked }`), then reads back the persisted
 * notificationPreferences "__global__" row and asserts it matches.
 *
 * Cases covered (in order, against one user's single reserved row):
 *   1. Seed a quiet-hours window + weekend setting first (so we can prove the
 *      defer toggle is a clean partial update that leaves them untouched).
 *   2. Turn the catch-up summary toggle ON — the UI sends
 *      `{ quietHoursDeferToSummary: true }`. Asserts the row is keyed by the
 *      reserved "__global__" trigger and quietHoursDeferToSummary persists as
 *      the boolean true, WITHOUT disturbing the saved quiet-hours window or
 *      weekend setting (partial update).
 *   3. Turn the catch-up summary toggle OFF — `{ quietHoursDeferToSummary:
 *      false }`. Asserts it persists as the boolean false, again leaving the
 *      window + weekend setting untouched.
 *
 * Run with: npx tsx test/defer-summary-settings-save.test.ts
 *
 * NOTES:
 * - DB-backed: seeds one dedicated, uniquely-named staff user and removes it
 *   (and its preference rows) at the end.
 * - Spins up the real Express app (registerRoutes) on an ephemeral port and
 *   authenticates with a minted session token (cookie-based auth), so the full
 *   route → Zod validation → storage upsert → DB path is exercised.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md); it is chained into the
 *   `test-privacy` validation. The uniquely-named user keeps it robust to a
 *   concurrent twin.
 */

import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { db } from "../server/db";
import { users, notificationPreferences } from "../shared/schema";
import { storage } from "../server/storage";
import { registerRoutes } from "../server/routes";
import { createSessionToken } from "../server/auth-middleware";
import { and, eq, inArray } from "drizzle-orm";

// Must match GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER in the client + server.
const GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER = "__global__";

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

const SUFFIX = `defer-save-${process.pid}-${Date.now()}`;
const createdUserIds: number[] = [];

let server: Server | null = null;
let baseUrl = "";

// ---------------------------------------------------------------------------
// Seed helper
// ---------------------------------------------------------------------------
async function makeStaff(label: string) {
  const user = await storage.createUser({
    username: `${label}-${SUFFIX}`,
    password: "x", // never used; auth is via minted token
    fullName: `${label} ${SUFFIX}`,
    email: `${label}-${SUFFIX}@example.test`,
    role: "therapist",
  } as any);
  createdUserIds.push(user.id);
  return user;
}

// Drive the exact save endpoint the settings screen calls. `token` authenticates
// as the staff user via the same cookie the browser sends.
async function saveGlobalPref(token: string, body: object) {
  const res = await fetch(
    `${baseUrl}/api/notifications/preferences/${GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: `sessionToken=${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  return res;
}

// Read back the persisted reserved row directly from the DB.
async function readGlobalRow(userId: number) {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(
          notificationPreferences.triggerType,
          GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER,
        ),
      ),
    );
  return row;
}

// ---------------------------------------------------------------------------
async function main() {
  // --- Build the real app ---------------------------------------------------
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: false, limit: "50mb" }));
  app.use(cookieParser());
  server = await registerRoutes(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  try {
    const staff = await makeStaff("defer-save-staff");
    const token = createSessionToken(staff);

    // The catch-up summary toggle is only usable when quiet hours or weekend
    // muting is active. Seed a quiet-hours window + weekend setting through the
    // same endpoint first, so we can later prove the defer toggle is a clean
    // partial update that leaves them untouched.
    const quietStart = "22:00"; // from the "From" time input ('HH:MM')
    const quietEnd = "06:30"; // from the "Until" time input ('HH:MM')

    // ===================================================================
    // 1. Seed the quiet-hours window + weekend setting.
    // ===================================================================
    {
      const res = await saveGlobalPref(token, {
        quietHoursStart: `${quietStart}:00`,
        quietHoursEnd: `${quietEnd}:00`,
        weekendsEnabled: false,
      });
      assertEqual(res.status, 200, "Seeding quiet-hours window returns 200");

      const row = await readGlobalRow(staff.id);
      assertEqual(
        row?.quietHoursStart,
        "22:00:00",
        "Seed: quietHoursStart persists as 'HH:MM:SS'",
      );
      assertEqual(
        row?.quietHoursEnd,
        "06:30:00",
        "Seed: quietHoursEnd persists as 'HH:MM:SS'",
      );
      assertEqual(
        row?.weekendsEnabled,
        false,
        "Seed: weekendsEnabled persists as the boolean false",
      );
      // The defer toggle should default OFF before we touch it.
      assertEqual(
        row?.quietHoursDeferToSummary,
        false,
        "Seed: quietHoursDeferToSummary defaults to the boolean false",
      );
    }

    // ===================================================================
    // 2. Turn the catch-up summary toggle ON — must not disturb the window.
    // ===================================================================
    {
      const res = await saveGlobalPref(token, {
        quietHoursDeferToSummary: true,
      });
      assertEqual(res.status, 200, "Saving catch-up summary ON returns 200");

      const row = await readGlobalRow(staff.id);
      assertEqual(
        Boolean(row),
        true,
        "A '__global__' preference row is persisted after saving the toggle",
      );
      assertEqual(
        row?.triggerType,
        GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER,
        "Row is keyed by the reserved '__global__' trigger type",
      );
      assertEqual(
        row?.quietHoursDeferToSummary,
        true,
        "quietHoursDeferToSummary persists as the boolean true",
      );
      assertEqual(
        row?.quietHoursStart,
        "22:00:00",
        "Quiet-hours start is UNTOUCHED by the defer toggle (partial update)",
      );
      assertEqual(
        row?.quietHoursEnd,
        "06:30:00",
        "Quiet-hours end is UNTOUCHED by the defer toggle (partial update)",
      );
      assertEqual(
        row?.weekendsEnabled,
        false,
        "Weekend setting is UNTOUCHED by the defer toggle (partial update)",
      );
    }

    // ===================================================================
    // 3. Turn the catch-up summary toggle OFF — must not disturb the window.
    // ===================================================================
    {
      const res = await saveGlobalPref(token, {
        quietHoursDeferToSummary: false,
      });
      assertEqual(res.status, 200, "Saving catch-up summary OFF returns 200");

      const row = await readGlobalRow(staff.id);
      assertEqual(
        row?.quietHoursDeferToSummary,
        false,
        "quietHoursDeferToSummary persists as the boolean false",
      );
      assertEqual(
        row?.quietHoursStart,
        "22:00:00",
        "Quiet-hours start is still UNTOUCHED after turning the toggle OFF",
      );
      assertEqual(
        row?.quietHoursEnd,
        "06:30:00",
        "Quiet-hours end is still UNTOUCHED after turning the toggle OFF",
      );
      assertEqual(
        row?.weekendsEnabled,
        false,
        "Weekend setting is still UNTOUCHED after turning the toggle OFF",
      );
    }
  } finally {
    // Cleanup — remove our preference rows + user, then close the server.
    try {
      if (createdUserIds.length > 0) {
        await db
          .delete(notificationPreferences)
          .where(inArray(notificationPreferences.userId, createdUserIds));
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
    } catch (cleanupErr) {
      console.error("⚠️  Cleanup error:", cleanupErr);
    }
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
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

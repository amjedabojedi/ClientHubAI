/**
 * Automated Test: the staff Notifications settings screen actually SAVES the
 * account-wide quiet-hours window + weekend toggle.
 *
 * Task #49 added a server-side test proving quiet hours / weekend muting
 * suppress emails when the reserved "__global__" preference row is set
 * correctly (see test/quiet-hours-suppression.test.ts). But that test seeds the
 * row directly — it never exercises the SAVE flow the staff UI uses. A
 * regression in the form (wrong trigger key, missing 'HH:MM' ↔ 'HH:MM:SS'
 * conversion, or failing to clear BOTH ends when quiet hours is turned off)
 * could leave staff thinking they muted after-hours pings when nothing was
 * persisted — the same trust gap that motivated proving the email opt-out.
 *
 * This suite drives the REAL save endpoint the UI calls
 * (`PUT /api/notifications/preferences/__global__`) over HTTP, with the EXACT
 * request bodies the settings screen builds (see
 * client/src/pages/notifications.tsx), then reads back the persisted
 * notificationPreferences "__global__" row and asserts it matches.
 *
 * Cases covered (in order, against one user's single reserved row):
 *   1. Turn quiet hours ON — the UI sends `{ quietHoursStart: \`${HH:MM}:00\`,
 *      quietHoursEnd: \`${HH:MM}:00\` }`. Asserts the row is keyed by the
 *      "__global__" trigger and both ends persist as 'HH:MM:SS' (the
 *      'HH:MM' → 'HH:MM:SS' conversion happened).
 *   2. Turn the weekend toggle OFF — the UI sends `{ weekendsEnabled: false }`.
 *      Asserts weekendsEnabled persists as the boolean false WITHOUT disturbing
 *      the saved quiet-hours window (partial update).
 *   3. Turn quiet hours OFF — the UI sends `{ quietHoursStart: null,
 *      quietHoursEnd: null }`. Asserts BOTH ends persist as null (so the gate
 *      correctly reads "quiet hours off"), and weekendsEnabled is untouched.
 *   4. Turn the weekend toggle back ON — `{ weekendsEnabled: true }` persists.
 *
 * Run with: npx tsx test/quiet-hours-settings-save.test.ts
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

const SUFFIX = `qh-save-${process.pid}-${Date.now()}`;
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
    const staff = await makeStaff("qh-save-staff");
    const token = createSessionToken(staff);

    // The settings screen holds the window in <input type="time"> values
    // ('HH:MM') and appends ':00' to build the request body. We mirror that
    // here so the test proves the 'HH:MM' → 'HH:MM:SS' conversion end-to-end.
    const quietStart = "21:30"; // from the "From" time input
    const quietEnd = "07:15"; // from the "Until" time input

    // ===================================================================
    // 1. Turn quiet hours ON via the save endpoint.
    // ===================================================================
    {
      const res = await saveGlobalPref(token, {
        quietHoursStart: `${quietStart}:00`,
        quietHoursEnd: `${quietEnd}:00`,
      });
      assertEqual(res.status, 200, "Saving quiet-hours ON returns 200");

      const row = await readGlobalRow(staff.id);
      assertEqual(
        Boolean(row),
        true,
        "A '__global__' preference row is persisted after saving quiet hours",
      );
      assertEqual(
        row?.triggerType,
        GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER,
        "Row is keyed by the reserved '__global__' trigger type",
      );
      assertEqual(
        row?.quietHoursStart,
        "21:30:00",
        "quietHoursStart persists as 'HH:MM:SS' (HH:MM was converted on save)",
      );
      assertEqual(
        row?.quietHoursEnd,
        "07:15:00",
        "quietHoursEnd persists as 'HH:MM:SS' (HH:MM was converted on save)",
      );
    }

    // ===================================================================
    // 2. Turn the weekend toggle OFF — must not disturb the saved window.
    // ===================================================================
    {
      const res = await saveGlobalPref(token, { weekendsEnabled: false });
      assertEqual(res.status, 200, "Saving weekend toggle OFF returns 200");

      const row = await readGlobalRow(staff.id);
      assertEqual(
        row?.weekendsEnabled,
        false,
        "weekendsEnabled persists as the boolean false",
      );
      assertEqual(
        row?.quietHoursStart,
        "21:30:00",
        "Quiet-hours start is UNTOUCHED by the weekend toggle (partial update)",
      );
      assertEqual(
        row?.quietHoursEnd,
        "07:15:00",
        "Quiet-hours end is UNTOUCHED by the weekend toggle (partial update)",
      );
    }

    // ===================================================================
    // 3. Turn quiet hours OFF — BOTH ends must be cleared to null.
    // ===================================================================
    {
      const res = await saveGlobalPref(token, {
        quietHoursStart: null,
        quietHoursEnd: null,
      });
      assertEqual(res.status, 200, "Saving quiet-hours OFF returns 200");

      const row = await readGlobalRow(staff.id);
      assertEqual(
        row?.quietHoursStart,
        null,
        "Turning quiet hours OFF persists a NULL start",
      );
      assertEqual(
        row?.quietHoursEnd,
        null,
        "Turning quiet hours OFF persists a NULL end",
      );
      assertEqual(
        row?.weekendsEnabled,
        false,
        "Turning quiet hours OFF leaves the weekend setting untouched",
      );
    }

    // ===================================================================
    // 4. Turn the weekend toggle back ON.
    // ===================================================================
    {
      const res = await saveGlobalPref(token, { weekendsEnabled: true });
      assertEqual(res.status, 200, "Saving weekend toggle ON returns 200");

      const row = await readGlobalRow(staff.id);
      assertEqual(
        row?.weekendsEnabled,
        true,
        "weekendsEnabled persists as the boolean true",
      );
      assertEqual(
        row?.quietHoursStart,
        null,
        "Quiet hours stay OFF after re-enabling weekends",
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

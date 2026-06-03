/**
 * Browser-level Test: clicking the catch-up summary Switch on the staff
 * Notifications settings screen ACTUALLY SAVES through the real end-to-end UI
 * path — the one the seed-the-cache hydration/gating test
 * (test/quiet-hours-summary-toggle-ui.test.ts) deliberately does NOT exercise.
 *
 * What this proves that the sibling UI test cannot:
 *   user clicks data-testid="switch-defer-summary"
 *     → onCheckedChange fires setGlobalPreferenceMutation
 *     → apiRequest() PUT /api/notifications/preferences/__global__ attaches the
 *       x-csrf-token header read from document.cookie via getCsrfToken()
 *     → the REAL csrfProtection middleware (mounted exactly as server/index.ts
 *       mounts it) validates header === csrfToken cookie
 *     → storage persists quietHoursDeferToSummary
 *     → onSuccess invalidates ["/api/notifications/preferences"]
 *     → the refetch (also a real fetch) rehydrates the SAME mounted Switch.
 * We assert on the PERSISTED DB row (not just the cache) after the click, so a
 * break in the CSRF wiring, the onCheckedChange handler, or the save endpoint
 * would fail this test.
 *
 * Negative control: with the csrfToken cookie removed, the same click is
 * REJECTED (403) by csrfProtection and the DB row does NOT change — proving the
 * CSRF round-trip is genuinely enforced, not incidental.
 *
 * HOW THIS IS "BROWSER-LEVEL":
 * - Spins up the REAL Express app (registerRoutes) AND the REAL optionalAuth +
 *   /api csrfProtection middleware stack from server/index.ts, on an ephemeral
 *   port.
 * - Renders the REAL exported NotificationsPage React component into jsdom and
 *   drives a genuine click on the radix Switch <button>.
 * - Patches global.fetch ONLY to (a) resolve the app's relative URLs against the
 *   test server and (b) forward document.cookie as the Cookie header (jsdom does
 *   not maintain a fetch cookie jar) — the browser's own cookie + CSRF behavior
 *   is what we are emulating, not bypassing.
 *
 * Run with: npx tsx test/quiet-hours-summary-toggle-save-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds one dedicated, uniquely-named staff user and removes it
 *   (and its preference rows) at the end.
 * - Must run serially with the other app-level tests (see
 *   .agents/memory/privacy-test-concurrency.md). The uniquely-named user keeps
 *   it robust to a concurrent twin.
 */

import { JSDOM } from "jsdom";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import { db } from "../server/db";
import { users, notificationPreferences } from "../shared/schema";
import { storage } from "../server/storage";
import { registerRoutes } from "../server/routes";
import {
  createSessionToken,
  optionalAuth,
  csrfProtection,
} from "../server/auth-middleware";
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

const SUFFIX = `qh-save-ui-${process.pid}-${Date.now()}`;
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

// Read the persisted reserved "__global__" row straight from the DB.
async function getGlobalRow(userId: number) {
  const rows = await db
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
  return rows[0];
}

// ---------------------------------------------------------------------------
async function main() {
  // --- jsdom browser environment (must be set before importing react-dom) ---
  const dom = new JSDOM(
    "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/", pretendToBeVisual: true },
  );
  const g = global as any;
  g.window = dom.window;
  g.document = dom.window.document;
  g.navigator = dom.window.navigator;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.Node = dom.window.Node;
  g.Element = dom.window.Element;
  g.getComputedStyle = dom.window.getComputedStyle;
  g.localStorage = dom.window.localStorage;
  g.location = dom.window.location;
  g.history = dom.window.history;
  g.CustomEvent = dom.window.CustomEvent;
  g.Event = dom.window.Event;
  g.MutationObserver = dom.window.MutationObserver;
  g.requestAnimationFrame =
    dom.window.requestAnimationFrame ||
    ((cb: any) => setTimeout(() => cb(Date.now()), 0));
  g.cancelAnimationFrame =
    dom.window.cancelAnimationFrame || ((id: any) => clearTimeout(id));
  // Tell React this is a proper act() environment so updates flush cleanly.
  g.IS_REACT_ACT_ENVIRONMENT = true;

  // --- Patch global.fetch -----------------------------------------------------
  // The real client calls fetch() with RELATIVE urls and credentials:"include".
  // jsdom does not resolve those against our ephemeral server and keeps no fetch
  // cookie jar, so we (1) rewrite leading-"/" urls to the test server and
  // (2) forward document.cookie as the Cookie header. This is precisely what a
  // browser does for same-origin requests; the CSRF header is still produced by
  // the app's own getCsrfToken() reading document.cookie.
  const originalFetch = global.fetch.bind(global);
  g.fetch = (async (input: any, init: any = {}) => {
    let url = typeof input === "string" ? input : input?.url;
    if (typeof url === "string" && url.startsWith("/")) {
      url = baseUrl + url;
    }
    const headers = new Headers((init && init.headers) || {});
    const cookie = dom.window.document.cookie;
    if (cookie) headers.set("Cookie", cookie);
    return originalFetch(url as any, { ...init, headers });
  }) as any;

  // --- Dynamic imports (after jsdom globals exist) --------------------------
  const React = (await import("react")).default;
  // The client TSX is transpiled with the classic JSX runtime (React.createElement)
  // and does not import React itself, so expose it as a global.
  g.React = React;
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  );
  const NotificationsPage = (await import("../client/src/pages/notifications"))
    .default;
  const { AuthContext } = await import("../client/src/hooks/useAuth");

  // A QueryClient that lets real refetches through (so the post-save
  // invalidate→refetch hits the live server), but never retries.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: async () => [],
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        staleTime: 0,
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  });

  // --- Build the real app (mirrors server/index.ts middleware stack) --------
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: false, limit: "50mb" }));
  app.use(cookieParser());
  app.use(optionalAuth);
  // CSRF protection for /api (POST/PUT/DELETE) — same gate as server/index.ts.
  app.use("/api", (req, res, next) => {
    const publicPaths = [
      "/auth/login",
      "/auth/logout",
      "/portal/login",
      "/portal/logout",
      "/portal/activate",
      "/portal/forgot-password",
      "/portal/reset-password",
    ];
    if (publicPaths.includes(req.path) || req.path.startsWith("/portal/")) {
      return next();
    }
    return csrfProtection(req as any, res, next);
  });
  server = await registerRoutes(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  let root: ReturnType<typeof createRoot> | null = null;

  try {
    const staff = await makeStaff("qh-save-ui-staff");
    const token = createSessionToken(staff);
    const csrf = `test-csrf-${Math.random().toString(36).slice(2)}`;

    // Set the cookies the browser would hold after login: an httpOnly-style
    // sessionToken (we can set it here in jsdom) + the JS-readable csrfToken.
    // getCsrfToken() reads csrfToken; our fetch patch forwards both to the API.
    dom.window.document.cookie = `sessionToken=${token}; path=/`;
    dom.window.document.cookie = `csrfToken=${csrf}; path=/`;

    // Seed an initial persisted "__global__" row with quiet hours ACTIVE so the
    // catch-up summary Switch is ENABLED, and the catch-up summary itself OFF.
    await storage.setUserNotificationPreference(
      staff.id,
      GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER,
      {
        quietHoursStart: "22:00:00",
        quietHoursEnd: "06:30:00",
        quietHoursDeferToSummary: false,
      } as any,
    );

    const seededRow = await getGlobalRow(staff.id);
    assertEqual(
      Boolean(seededRow),
      true,
      "Seed: a persisted __global__ row exists before rendering",
    );
    assertEqual(
      seededRow.quietHoursDeferToSummary,
      false,
      "Seed: catch-up summary starts OFF in the DB",
    );

    // The non-admin staff member (therapist) gets the 2-tab layout; we render
    // with a fully-populated AuthContext so useAuth() resolves to this user.
    const authValue = {
      user: staff as any,
      isAuthenticated: true,
      isLoading: false,
      loginError: "",
      login: async () => ({ success: true }),
      logout: () => {},
      clearLoginError: () => {},
    };

    // Seed the page's other always-on queries so nothing is "loading", and seed
    // the preferences query with the REAL persisted row so the first paint is
    // correct. Subsequent refetches (after the click) go to the live server.
    queryClient.setQueryData(["/api/notifications"], []);
    queryClient.setQueryData(
      ["/api/notifications/preferences"],
      [seededRow],
    );

    // Resolve a rendered radix Switch <button> by its data-testid.
    function getSwitch(testid: string): HTMLButtonElement | null {
      return dom.window.document.querySelector(
        `[data-testid="${testid}"]`,
      ) as HTMLButtonElement | null;
    }
    const isChecked = (el: HTMLButtonElement | null) =>
      el?.getAttribute("aria-checked") === "true";
    const isDisabled = (el: HTMLButtonElement | null) =>
      el?.hasAttribute("disabled") ?? false;

    const settle = async (ms = 0) => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
      });
    };

    // Poll the DB until the flag matches (the click → save → persist is async).
    async function waitForDeferFlag(
      userId: number,
      expected: boolean,
      timeoutMs = 4000,
    ) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const row = await getGlobalRow(userId);
        if (row && row.quietHoursDeferToSummary === expected) return row;
        await settle(25);
      }
      return getGlobalRow(userId);
    }

    // Poll the rendered switch until its checked state matches (the post-save
    // invalidate→refetch→rehydrate is async and may lag the DB write).
    async function waitForSwitchChecked(
      testid: string,
      expected: boolean,
      timeoutMs = 4000,
    ) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (isChecked(getSwitch(testid)) === expected) return true;
        await settle(25);
      }
      return isChecked(getSwitch(testid)) === expected;
    }

    // --- Render + open the Preferences tab ------------------------------------
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root!.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(
            AuthContext.Provider,
            { value: authValue as any },
            React.createElement(NotificationsPage as any, null),
          ),
        ),
      );
    });

    const prefTab = Array.from(
      dom.window.document.querySelectorAll('[role="tab"]'),
    ).find(
      (el) => (el.textContent || "").trim() === "Preferences",
    ) as HTMLElement | undefined;
    assertEqual(Boolean(prefTab), true, "Preferences tab trigger is rendered");
    await act(async () => {
      prefTab!.focus();
      prefTab!.click();
    });
    await settle();

    // --- Pre-click assertions: switch enabled (quiet hours active) + OFF ------
    const deferBefore = getSwitch("switch-defer-summary");
    assertEqual(
      Boolean(deferBefore),
      true,
      "Catch-up summary switch (switch-defer-summary) is rendered",
    );
    assertEqual(
      isDisabled(deferBefore),
      false,
      "Catch-up summary switch is ENABLED (quiet hours active)",
    );
    assertEqual(
      isChecked(deferBefore),
      false,
      "Catch-up summary switch starts UNCHECKED (mirrors seeded OFF)",
    );

    // ===================================================================
    // 1. CLICK to turn the catch-up summary ON. This must travel the full
    //    onCheckedChange → apiRequest (with x-csrf-token) → csrfProtection →
    //    persist path and flip the DB row to true.
    // ===================================================================
    await act(async () => {
      deferBefore!.click();
    });
    const rowAfterOn = await waitForDeferFlag(staff.id, true);
    assertEqual(
      rowAfterOn?.quietHoursDeferToSummary,
      true,
      "SAVE: clicking the switch persisted quietHoursDeferToSummary=true in the DB",
    );

    // The invalidate→refetch should rehydrate the SAME mounted switch as ON.
    const switchOn = await waitForSwitchChecked("switch-defer-summary", true);
    assertEqual(
      switchOn,
      true,
      "After save, the rendered switch reflects the persisted ON value",
    );

    // ===================================================================
    // 2. CLICK again to turn it OFF — proving the round-trip both ways.
    // ===================================================================
    await act(async () => {
      getSwitch("switch-defer-summary")!.click();
    });
    const rowAfterOff = await waitForDeferFlag(staff.id, false);
    assertEqual(
      rowAfterOff?.quietHoursDeferToSummary,
      false,
      "SAVE: clicking again persisted quietHoursDeferToSummary=false in the DB",
    );
    const switchOff = await waitForSwitchChecked("switch-defer-summary", false);
    assertEqual(
      switchOff,
      true,
      "After the second save, the rendered switch reflects the persisted OFF value",
    );

    // ===================================================================
    // 3. NEGATIVE CONTROL: drop the csrfToken cookie so getCsrfToken() returns
    //    null and no x-csrf-token header is sent. The same click must be
    //    REJECTED by csrfProtection (403) and the DB row must NOT change —
    //    proving the CSRF round-trip is genuinely enforced.
    // ===================================================================
    // Expire the csrfToken cookie (keep sessionToken so it's specifically CSRF
    // that fails, not auth).
    dom.window.document.cookie =
      "csrfToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    assertEqual(
      dom.window.document.cookie.includes("csrfToken="),
      false,
      "Negative control: csrfToken cookie removed",
    );

    const beforeNeg = await getGlobalRow(staff.id);
    await act(async () => {
      getSwitch("switch-defer-summary")!.click();
    });
    // Give the (failing) request time to round-trip.
    await settle(200);
    const afterNeg = await getGlobalRow(staff.id);
    assertEqual(
      afterNeg?.quietHoursDeferToSummary,
      beforeNeg?.quietHoursDeferToSummary,
      "Negative control: without a CSRF token the click does NOT persist (DB unchanged)",
    );
  } finally {
    // Unmount + cleanup.
    try {
      if (root) {
        await act(async () => {
          root!.unmount();
        });
      }
    } catch (unmountErr) {
      console.error("⚠️  Unmount error:", unmountErr);
    }
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

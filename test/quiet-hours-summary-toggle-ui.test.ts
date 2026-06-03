/**
 * Browser-level Test: the staff Notifications settings screen renders the
 * quiet-hours / weekend / catch-up summary toggles correctly — proving the two
 * client-only behaviors the server-side save tests CANNOT exercise:
 *
 *   1. GATING: the "Send a catch-up summary" Switch
 *      (data-testid="switch-defer-summary") is DISABLED until quiet hours OR
 *      weekend muting is active (`disabled={!mutingActive}` in
 *      client/src/pages/notifications.tsx), and becomes ENABLED once one of
 *      those is turned on — via EITHER the quiet-hours window OR weekend muting.
 *   2. LOAD-TIME HYDRATION: each toggle renders the persisted reserved
 *      "__global__" notificationPreferences value on initial load (no stale or
 *      empty state) — quiet-hours checked/unchecked, weekend checked/unchecked,
 *      and the catch-up summary checked/unchecked all mirror what was saved.
 *
 * Task #54/#57 added test/quiet-hours-settings-save.test.ts and
 * test/defer-summary-settings-save.test.ts, proving the window + weekend + defer
 * toggles SAVE through the real endpoint. But neither renders the actual React
 * screen, so a regression in the `disabled={!mutingActive}` gate or in
 * load-time hydration (e.g. reading the wrong field, or not deriving
 * mutingActive from BOTH quiet hours and weekend muting) would leave staff
 * unable to enable the summary, or showing a stale toggle, with no test
 * catching it.
 *
 * HOW THIS IS "BROWSER-LEVEL":
 * - Spins up the REAL Express app (registerRoutes) on an ephemeral port and
 *   round-trips every preference through the REAL save endpoint
 *   (`PUT /api/notifications/preferences/__global__`) and the REAL read endpoint
 *   (`GET /api/notifications/preferences`) — the same calls the browser makes.
 * - Renders the REAL exported NotificationsPage React component into a jsdom DOM
 *   with react-dom/client, seeding TanStack Query with the EXACT array the read
 *   endpoint returns, then asserts on the live rendered DOM elements by their
 *   data-testid (the radix Switch renders a <button role="switch"> exposing
 *   `disabled` + `aria-checked`/`data-state`).
 * - Drives state changes the way the screen does: after each real save we seed
 *   the refreshed server response into the query cache, mirroring the
 *   invalidate→refetch the mutation triggers, and assert the SAME mounted
 *   switch reacts (disabled→enabled, unchecked→checked).
 *
 * Run with: npx tsx test/quiet-hours-summary-toggle-ui.test.ts
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
import { createSessionToken } from "../server/auth-middleware";
import { inArray } from "drizzle-orm";

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

const SUFFIX = `qh-ui-${process.pid}-${Date.now()}`;
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

// Drive the exact save endpoint the settings screen calls.
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
  if (res.status !== 200) {
    throw new Error(`saveGlobalPref failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

// Read back the persisted preferences via the EXACT endpoint + queryKey the
// settings screen uses (["/api/notifications/preferences"]).
async function fetchPrefs(token: string): Promise<any[]> {
  const res = await fetch(`${baseUrl}/api/notifications/preferences`, {
    headers: { Cookie: `sessionToken=${token}` },
  });
  if (res.status !== 200) {
    throw new Error(`fetchPrefs failed: ${res.status} ${await res.text()}`);
  }
  return await res.json();
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

  // A QueryClient that NEVER hits the network: seeded data is treated as fresh,
  // and any unseeded query resolves to an empty list so the page renders.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: async () => [],
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  });

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

  let root: ReturnType<typeof createRoot> | null = null;

  try {
    const staff = await makeStaff("qh-ui-staff");
    const token = createSessionToken(staff);

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

    // Seed the page's other always-on queries so nothing is "loading".
    queryClient.setQueryData(["/api/notifications"], []);

    // Push the latest persisted preferences into the cache, exactly as the
    // invalidate→refetch after a save would.
    async function syncPrefsFromServer() {
      const prefs = await fetchPrefs(token);
      await act(async () => {
        queryClient.setQueryData(
          ["/api/notifications/preferences"],
          prefs,
        );
      });
      return prefs;
    }

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

    // ===================================================================
    // 0. Seed an initial persisted "__global__" row: weekend notifications
    //    ON, no quiet hours, catch-up summary OFF — i.e. muting INACTIVE.
    //    Then render the real screen and switch to the Preferences tab.
    // ===================================================================
    await saveGlobalPref(token, { weekendsEnabled: true });
    await fetchPrefs(token).then((prefs) =>
      queryClient.setQueryData(["/api/notifications/preferences"], prefs),
    );

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

    // Switch to the "Preferences" tab (radix Tabs only mounts active content).
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
    // Let the tab content mount + effects settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The account-wide switches should now be on screen.
    const weekendSwitch0 = getSwitch("switch-weekend-notifications");
    const deferSwitch0 = getSwitch("switch-defer-summary");
    assertEqual(
      Boolean(weekendSwitch0),
      true,
      "Weekend notifications switch is rendered on the Preferences tab",
    );
    assertEqual(
      Boolean(deferSwitch0),
      true,
      "Catch-up summary switch (switch-defer-summary) is rendered",
    );

    // --- HYDRATION (muting inactive): toggles mirror the persisted row -----
    assertEqual(
      isChecked(weekendSwitch0),
      true,
      "Hydration: weekend switch renders persisted weekendsEnabled=true (checked)",
    );
    assertEqual(
      isChecked(deferSwitch0),
      false,
      "Hydration: catch-up summary renders persisted default OFF (unchecked)",
    );
    // --- GATING (muting inactive): catch-up summary is DISABLED -------------
    assertEqual(
      isDisabled(deferSwitch0),
      true,
      "Gating: catch-up summary is DISABLED when neither quiet hours nor weekend muting is active",
    );

    // ===================================================================
    // 1. Turn QUIET HOURS on (real save). mutingActive becomes true via the
    //    quiet-hours path → the catch-up summary switch becomes ENABLED.
    // ===================================================================
    await saveGlobalPref(token, {
      quietHoursStart: "22:00:00",
      quietHoursEnd: "06:30:00",
    });
    await syncPrefsFromServer();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const deferSwitch1 = getSwitch("switch-defer-summary");
    assertEqual(
      isDisabled(deferSwitch1),
      false,
      "Gating: catch-up summary becomes ENABLED once quiet hours is turned on",
    );

    // ===================================================================
    // 2. Turn the catch-up summary ON (real save) → it hydrates as checked.
    // ===================================================================
    await saveGlobalPref(token, { quietHoursDeferToSummary: true });
    await syncPrefsFromServer();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const deferSwitch2 = getSwitch("switch-defer-summary");
    assertEqual(
      isDisabled(deferSwitch2),
      false,
      "Catch-up summary stays ENABLED while quiet hours is active",
    );
    assertEqual(
      isChecked(deferSwitch2),
      true,
      "Hydration: catch-up summary renders persisted quietHoursDeferToSummary=true (checked)",
    );

    // ===================================================================
    // 3. Prove the WEEKEND path of the gate independently: turn quiet hours
    //    OFF but weekend muting ON. mutingActive must stay true via the
    //    weekend path, so the catch-up summary remains ENABLED.
    // ===================================================================
    await saveGlobalPref(token, {
      quietHoursStart: null,
      quietHoursEnd: null,
      weekendsEnabled: false,
    });
    await syncPrefsFromServer();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const weekendSwitch3 = getSwitch("switch-weekend-notifications");
    const deferSwitch3 = getSwitch("switch-defer-summary");
    assertEqual(
      isChecked(weekendSwitch3),
      false,
      "Hydration: weekend switch renders persisted weekendsEnabled=false (unchecked)",
    );
    assertEqual(
      isDisabled(deferSwitch3),
      false,
      "Gating: catch-up summary stays ENABLED via the weekend-muting path (quiet hours off)",
    );
    assertEqual(
      isChecked(deferSwitch3),
      true,
      "Hydration: catch-up summary keeps its persisted ON value across the change",
    );

    // ===================================================================
    // 4. Turn BOTH off (weekend back ON, no quiet hours) → muting INACTIVE
    //    again → the catch-up summary returns to DISABLED.
    // ===================================================================
    await saveGlobalPref(token, { weekendsEnabled: true });
    await syncPrefsFromServer();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const deferSwitch4 = getSwitch("switch-defer-summary");
    assertEqual(
      isDisabled(deferSwitch4),
      true,
      "Gating: catch-up summary returns to DISABLED once both quiet hours and weekend muting are off",
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

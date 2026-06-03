/**
 * Browser-level Test: the staff Notifications settings screen renders the
 * quiet-hours TIME WINDOW correctly — proving the two client-only behaviors the
 * server-side save tests CANNOT exercise:
 *
 *   1. LOAD-TIME HYDRATION of the time inputs: when a quiet-hours window is
 *      persisted on the reserved "__global__" notificationPreferences row, the
 *      "From" (data-testid="input-quiet-start") and "Until"
 *      (data-testid="input-quiet-end") <input type="time"> fields render the
 *      persisted values — converted from the stored 'HH:MM:SS' to the
 *      browser-friendly 'HH:MM' via toTimeInputValue() in
 *      client/src/pages/notifications.tsx. A regression where the inputs don't
 *      hydrate (stuck on the useState defaults, or reading the wrong field)
 *      would leave staff staring at a window they never set.
 *
 *   2. SAVE-BUTTON GATING: the "Save window" button
 *      (data-testid="button-save-quiet-hours") is `disabled={!quietStart ||
 *      !quietEnd}` — i.e. it must be ENABLED when both times are present and
 *      DISABLED the moment either time input is cleared, so staff can never
 *      "save" a half-filled (invalid) quiet window and think it took.
 *
 * Task #61: test/quiet-hours-summary-toggle-ui.test.ts covers the three
 * account-wide Switches (quiet hours / weekend / catch-up summary) but does NOT
 * cover the time inputs that appear when quiet hours is on, nor the Save-window
 * button's disabled-gate. This test fills that gap.
 *
 * HOW THIS IS "BROWSER-LEVEL":
 * - Spins up the REAL Express app (registerRoutes) on an ephemeral port and
 *   round-trips the quiet-hours window through the REAL save endpoint
 *   (`PUT /api/notifications/preferences/__global__`) and REAL read endpoint
 *   (`GET /api/notifications/preferences`) — the same calls the browser makes.
 * - Renders the REAL exported NotificationsPage React component into a jsdom DOM
 *   with react-dom/client, seeding TanStack Query with the EXACT array the read
 *   endpoint returns, then asserts on the live rendered DOM <input> + <button>
 *   elements by their data-testid.
 * - Drives the inputs the way the screen does: clears/sets the controlled
 *   <input type="time"> via the native value setter + a bubbling input event
 *   (React's controlled-input contract) and asserts the SAME mounted Save
 *   button reacts (enabled→disabled→enabled).
 *
 * Run with: npx tsx test/quiet-hours-window-inputs-ui.test.ts
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

const SUFFIX = `qh-win-${process.pid}-${Date.now()}`;
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
  g.HTMLInputElement = dom.window.HTMLInputElement;
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
    const staff = await makeStaff("qh-win-staff");
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

    // Resolve rendered elements by their data-testid.
    function getEl<T extends Element>(testid: string): T | null {
      return dom.window.document.querySelector(
        `[data-testid="${testid}"]`,
      ) as T | null;
    }
    const isDisabled = (el: Element | null) =>
      el?.hasAttribute("disabled") ?? false;

    // Set a React-controlled <input> value the way a browser would: use the
    // native value setter (so React's input tracker sees the change) then fire
    // a bubbling input event to trigger the onChange handler.
    function setInputValue(input: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    }

    // ===================================================================
    // 0. Seed a persisted "__global__" quiet-hours window. The stored format
    //    is 'HH:MM:SS'; the screen must surface 'HH:MM' in the time inputs.
    //    Pick an "Until" that differs from the useState default ("08:00") so a
    //    failure-to-hydrate (stuck on the default) is actually caught.
    // ===================================================================
    await saveGlobalPref(token, {
      quietHoursStart: "22:00:00",
      quietHoursEnd: "06:30:00",
    });
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
    // Let the tab content mount + the hydration effect settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // ===================================================================
    // 1. HYDRATION: the time inputs render only when quiet hours is on, and
    //    they show the persisted window converted to 'HH:MM'.
    // ===================================================================
    const startInput = getEl<HTMLInputElement>("input-quiet-start");
    const endInput = getEl<HTMLInputElement>("input-quiet-end");
    assertEqual(
      Boolean(startInput),
      true,
      "From input (input-quiet-start) is rendered when quiet hours is on",
    );
    assertEqual(
      Boolean(endInput),
      true,
      "Until input (input-quiet-end) is rendered when quiet hours is on",
    );
    assertEqual(
      startInput!.value,
      "22:00",
      "Hydration: From input shows persisted 22:00:00 → 22:00",
    );
    assertEqual(
      endInput!.value,
      "06:30",
      "Hydration: Until input shows persisted 06:30:00 → 06:30 (not the 08:00 default)",
    );

    // ===================================================================
    // 2. SAVE-BUTTON GATING: enabled with both times, disabled the moment
    //    either is cleared, re-enabled when restored.
    // ===================================================================
    const saveBtn = getEl<HTMLButtonElement>("button-save-quiet-hours");
    assertEqual(
      Boolean(saveBtn),
      true,
      "Save window button (button-save-quiet-hours) is rendered",
    );
    assertEqual(
      isDisabled(saveBtn),
      false,
      "Gating: Save window is ENABLED when both From and Until are set",
    );

    // Clear the "From" time → button must disable.
    await act(async () => {
      setInputValue(startInput!, "");
    });
    assertEqual(
      isDisabled(getEl<HTMLButtonElement>("button-save-quiet-hours")),
      true,
      "Gating: Save window becomes DISABLED when From is cleared",
    );

    // Restore "From" → button must re-enable.
    await act(async () => {
      setInputValue(getEl<HTMLInputElement>("input-quiet-start")!, "22:00");
    });
    assertEqual(
      isDisabled(getEl<HTMLButtonElement>("button-save-quiet-hours")),
      false,
      "Gating: Save window re-ENABLES once From is set again",
    );

    // Clear the "Until" time → button must disable (independent gate path).
    await act(async () => {
      setInputValue(getEl<HTMLInputElement>("input-quiet-end")!, "");
    });
    assertEqual(
      isDisabled(getEl<HTMLButtonElement>("button-save-quiet-hours")),
      true,
      "Gating: Save window becomes DISABLED when Until is cleared",
    );

    // Restore "Until" → button must re-enable.
    await act(async () => {
      setInputValue(getEl<HTMLInputElement>("input-quiet-end")!, "06:30");
    });
    assertEqual(
      isDisabled(getEl<HTMLButtonElement>("button-save-quiet-hours")),
      false,
      "Gating: Save window re-ENABLES once Until is set again",
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

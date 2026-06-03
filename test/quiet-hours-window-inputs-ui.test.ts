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

  // Restore handle for the patched global fetch (see below).
  const realFetch: typeof fetch = global.fetch.bind(global);

  try {
    const staff = await makeStaff("qh-win-staff");
    const token = createSessionToken(staff);

    // The REAL NotificationsPage calls apiRequest() → fetch() with a RELATIVE
    // url ("/api/notifications/preferences/__global__"). In a browser that
    // resolves against the page origin and carries the auth cookie; under jsdom
    // it would resolve against http://localhost/ (NOT our ephemeral test server)
    // and carry no session. Patch global.fetch so the component's own relative
    // requests reach the real Express app authenticated as this staff user —
    // i.e. the click drives the SAME endpoint the browser would.
    global.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      if (typeof url === "string" && url.startsWith("/")) {
        const headers = new dom.window.Headers(init?.headers || {});
        headers.set("Cookie", `sessionToken=${token}`);
        return realFetch(`${baseUrl}${url}`, { ...init, headers } as any);
      }
      return realFetch(input, init);
    }) as typeof fetch;

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

    // ===================================================================
    // 3. SAVE ROUND-TRIP: edit the window to NEW values, click the enabled
    //    "Save window" button, and prove the click actually persisted the
    //    edited 'HH:MM:SS' window through the REAL save endpoint — by reading
    //    it back via GET /api/notifications/preferences. This is the gap the
    //    hydration + gating tests leave open: a click handler that sends the
    //    wrong payload (drops the ':00' suffix, swaps start/end, fires the
    //    wrong mutation, or doesn't fire at all) would show a success toast
    //    yet save nothing — and only this assertion would catch it.
    //
    //    Pick NEW values that differ from BOTH the seeded window (22:00/06:30)
    //    and the useState defaults (22:00/08:00), so a no-op "save" can't pass.
    // ===================================================================
    const NEW_START = "23:15"; // → expected persisted "23:15:00"
    const NEW_END = "07:45"; //   → expected persisted "07:45:00"

    await act(async () => {
      setInputValue(getEl<HTMLInputElement>("input-quiet-start")!, NEW_START);
    });
    await act(async () => {
      setInputValue(getEl<HTMLInputElement>("input-quiet-end")!, NEW_END);
    });
    assertEqual(
      getEl<HTMLInputElement>("input-quiet-start")!.value,
      NEW_START,
      "Edit: From input reflects the new 23:15 value before saving",
    );
    assertEqual(
      getEl<HTMLInputElement>("input-quiet-end")!.value,
      NEW_END,
      "Edit: Until input reflects the new 07:45 value before saving",
    );

    const saveBtnBefore = getEl<HTMLButtonElement>("button-save-quiet-hours");
    assertEqual(
      isDisabled(saveBtnBefore),
      false,
      "Save round-trip: Save window is ENABLED with the edited window",
    );

    // Click the SAME mounted, enabled Save button. This fires the component's
    // real onClick → setGlobalPreferenceMutation.mutate(...) → apiRequest PUT
    // through our patched fetch to the real Express app.
    await act(async () => {
      saveBtnBefore!.click();
    });

    // Wait for the mutation's PUT to land server-side. Poll the REAL read
    // endpoint until the persisted window reflects the edit (or time out).
    let persisted: any = null;
    for (let i = 0; i < 50; i++) {
      const prefs = await fetchPrefs(token);
      const g2 = prefs.find(
        (p) => p.triggerType === GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER,
      );
      if (
        g2 &&
        g2.quietHoursStart === `${NEW_START}:00` &&
        g2.quietHoursEnd === `${NEW_END}:00`
      ) {
        persisted = g2;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    assertEqual(
      Boolean(persisted),
      true,
      "Save round-trip: clicking Save persisted a __global__ row via the real PUT endpoint",
    );
    assertEqual(
      persisted?.quietHoursStart,
      `${NEW_START}:00`,
      "Save round-trip: persisted quietHoursStart is the edited 23:15:00 (':00' suffix kept, not swapped)",
    );
    assertEqual(
      persisted?.quietHoursEnd,
      `${NEW_END}:00`,
      "Save round-trip: persisted quietHoursEnd is the edited 07:45:00 (':00' suffix kept, not swapped)",
    );
  } finally {
    // Restore the un-patched fetch so cleanup/other tests are unaffected.
    global.fetch = realFetch;

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

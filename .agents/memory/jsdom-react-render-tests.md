---
name: jsdom React render tests
description: How to render the real client React pages inside tsx (.test.ts) browser-level tests.
---

Browser-level tests that render real client pages (e.g. `client/src/pages/notifications.tsx`)
run under `npx tsx` against jsdom. To make the real exported component mount and
behave:

- **Set jsdom globals BEFORE importing react-dom or the page.** Use `await import(...)`
  (dynamic) for react / react-dom/client / the page / hooks, after assigning
  `global.window/document/navigator/HTMLElement/Node/getComputedStyle/localStorage`
  from a `new JSDOM(...)`. Static imports run too early.
- **`global.location` is required** — `posthog-js` (pulled in via `@/hooks/useAuth` →
  `@/lib/posthog`) reads bare `location` at module load and throws `location is not
  defined` without it. Also set `history`, `CustomEvent`, `Event`, `MutationObserver`,
  `requestAnimationFrame`.
- **Expose `global.React = React`.** The client TSX is transpiled with the *classic*
  JSX runtime (`React.createElement`) and does NOT import React itself, so without a
  global React the page throws `ReferenceError: React is not defined` at render.
- Set `global.IS_REACT_ACT_ENVIRONMENT = true` and wrap renders / state pokes in
  `await act(async () => {...})`.
- Provide `AuthContext.Provider` (from `@/hooks/useAuth`) with a full value object so
  `useAuth()` resolves; a `therapist` role gives the non-admin 2-tab layout.
- **radix Tabs only mount the active tab's content.** Switch tabs by finding the
  `[role="tab"]` whose text matches and calling `.focus()` then `.click()` in `act`.
- Use a test `QueryClient` with `queryFn: async () => []`, `staleTime: Infinity`,
  `refetchOnMount: false` so nothing hits the network; seed real data with
  `queryClient.setQueryData([...key], rows)`. radix `Switch` renders a
  `<button role="switch">` exposing `disabled` + `aria-checked`/`data-state`.

**Why:** these are non-obvious environment quirks; each one is a hard crash, not a soft
failure, so a future browser-level test will fail mysteriously without them.

## Exercising the REAL save path (clicks → apiRequest → server persist)

To prove a real switch/button click actually saves (not just hydration via seeded
cache), two extra things are required and both are easy to miss:

- **Patch `global.fetch`.** The client calls `fetch()` with RELATIVE urls and
  `credentials:"include"`; jsdom neither resolves those against your ephemeral test
  server nor keeps a fetch cookie jar. Wrap the original fetch so it (1) rewrites
  leading-`/` urls to `http://127.0.0.1:<port>` and (2) sets the `Cookie` header from
  `dom.window.document.cookie`. The app's own `getCsrfToken()` still reads
  `document.cookie` to set `x-csrf-token`, so set BOTH `sessionToken` and `csrfToken`
  via `document.cookie = "...; path=/"`.
- **Mount the CSRF middleware yourself.** `registerRoutes(app)` alone has NO csrf gate —
  csrf lives in `server/index.ts` (`app.use(optionalAuth)` + `app.use("/api", ... csrfProtection)`).
  Hydration-only tests omit it, so their direct PUTs succeed without a token. If you
  want the click to actually exercise CSRF wiring, replicate that middleware stack
  before `registerRoutes`. `csrfProtection` only checks `x-csrf-token` header ===
  `csrfToken` cookie, so any random csrf value works as long as both sides match.
- **Assert on the DB row**, not the cache, after the click; the
  invalidate→refetch→rehydrate is async, so poll both the DB flag and the rendered
  `aria-checked` until they match (fixed `setTimeout` waits flake).
- A **negative control** (drop the `csrfToken` cookie, click, assert DB unchanged)
  is what actually proves CSRF is enforced — the positive path passes even if csrf
  were entirely absent.

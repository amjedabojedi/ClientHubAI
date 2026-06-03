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

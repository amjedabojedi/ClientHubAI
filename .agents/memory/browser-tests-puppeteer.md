---
name: Browser-level tests with puppeteer
description: How to write Chromium browser tests for this app (auth, Radix tabs, chromium/cookie version pitfalls).
---

# Browser-level (puppeteer) tests

Browser tests live in `test/*.test.ts`, run via `npx tsx`, and drive a real
Chromium against a real dev server. They are chained into the `test-privacy`
validation and must run serially (see privacy-test-concurrency.md).

## Use the shared helper — don't re-implement setup
`test/helpers/browser.ts` is the single source of truth for the fragile setup:
`startDevServer()` (picks a free port, spawns the dev server, waits on /health,
returns `{ baseUrl, port, stop() }`), `launchBrowser()`/`resolveChromium()`,
`loginAs(page, {username,password})`, and `clickTab(page, /regex/)`. The pitfalls
below are encoded there inline. New browser suites should import these instead of
copying the boilerplate so a fix lands in one place.

## Spawning the app
Spawn `npx tsx server/index.ts` with a unique `PORT` (pick a free ephemeral port
yourself; the dev server reads `process.env.PORT`) and `NODE_ENV=development`,
then poll `/health` until ready (first Vite compile can take up to ~90s — allow
a generous, e.g. 120s, readiness deadline). Kill with SIGTERM (SIGKILL fallback)
at the end. Running this alongside the port-5000 "Start application" server is
fine — different ports.

## Authenticating in the browser — do NOT use page.setCookie
The bundled puppeteer-core is newer than the system Chromium (nix chromium
~125), so `page.setCookie({url,...})` throws `Network.deleteCookies ...
partitionKey ... string value expected`. Instead, authenticate the realistic
way: after `page.goto(baseUrl)`, run `fetch('/api/auth/login', {POST, credentials:'include'})`
inside `page.evaluate`. That sets the genuine httpOnly `sessionToken` + readable
`csrfToken` cookies via Set-Cookie. **Also** `localStorage.setItem('currentUser', JSON)`
with the returned user — the frontend's `useAuth` reads the logged-in user from
`localStorage.currentUser`, not from an API call, so without it the SPA renders
the login page. Seeded test users can use a plaintext password (login route
accepts non-bcrypt passwords for compatibility).

## Chromium binary
Resolve with: `PUPPETEER_EXECUTABLE_PATH` → `which chromium` (system nix binary)
→ `puppeteer.executablePath()`. Launch headless with
`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`.

## Radix UI interaction gotcha
Radix `Tabs` only mount the *active* tab's content, so a control inside an
inactive tab does not exist in the DOM until that tab is activated. A synthetic
`element.click()` run inside `page.evaluate` does NOT change the Radix tab — it
needs a trusted event. Use a real `ElementHandle.click()` (find the
`[role="tab"]` whose textContent matches) or `page.click(selector)`.

## clickablePoint fails during slide-in animations — click in-page instead
`ElementHandle.click()` / `page.click(selector)` run puppeteer's `clickablePoint`
check, which throws `Node is either not clickable or not an Element` when the
target is mid-transition (e.g. a shadcn/Radix `Sheet`/drawer sliding in with
`data-[state=open]:duration-500`, so its centre is momentarily off-screen) or is
a tiny icon button (the Radix close "X"). For PLAIN buttons with an `onClick`
(no trusted-event requirement, unlike Radix Tabs) just do an in-page DOM click:
`page.evaluate(sel => document.querySelector(sel).click(), selector)`. Reserve
trusted `ElementHandle.click()` for controls that truly need a real event.

## Testing context/history behavior without seeding data — DEV-only harness
To browser-test logic that lives in a React context and is independent of record
content (e.g. the record-drawer Back-button/history integration), add a DEV-only
route (`{import.meta.env.DEV && <Route .../>}`) rendering a tiny harness page that
drives the context API directly via buttons; register any throwaway drawer/type
only under `import.meta.env.DEV` so prod never sees it. Note: an open drawer's
overlay covers the underlying page, so controls to open DEEPER levels must live
INSIDE the drawer body (a registered component), exactly like the real app opens a
nested drawer from a control in its parent. Read live depth from a page-rendered
`data-testid` (DOM is readable behind the overlay); step history with
`page.evaluate(() => history.back())` and `waitForFunction` on the depth readout —
don't use `page.goBack()` for same-URL `pushState` entries (no navigation fires).

## Asserting persistence
Toggle, `page.waitForResponse` for the PUT (200), then `page.goto` to reload and
re-read the control's `aria-checked` from a fresh server fetch — that's what
proves server-side persistence vs. local React state. Cross-check the DB row too.

## Mocking the network for pure-frontend behavior (no DB/auth needed)
For UI-state assertions (loading spinner/disabled, error toasts) you don't need
to seed data. `/portal/*` routes render without staff auth (App.tsx Router gates
only staff routes), so `page.setRequestInterception(true)` + a `page.on('request')`
handler can fully fake the page: `req.respond()` the list endpoint with a fake
row, `req.continue()` everything else. To observe an *in-flight* loading state
deterministically, HOLD the action's response open — in the handler resolve a
"started" promise, then `await` a release promise the test resolves only after it
asserts the disabled/spinner state; then `respond()` 200. For the failure path,
`respond({status:500, body: JSON.stringify({message})})` and assert the toast
text (downloadFile surfaces `response.json().message`). Wrap the handler body in
try/catch with a fallback `continue()` so an already-handled request never hangs.

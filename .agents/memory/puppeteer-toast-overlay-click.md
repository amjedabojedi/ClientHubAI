---
name: Puppeteer toast overlay swallows trusted clicks
description: A shadcn toast portal can sit on top of a drawer's submit button, so puppeteer's coordinate-based click silently lands on the toast and the form never submits.
---

# Toast overlay swallows puppeteer trusted clicks on re-submit

When a browser test performs an action that fires a success toast (e.g. clicking
"Reload latest totals" -> "Totals reloaded" toast) and then immediately clicks a
submit button, puppeteer's **trusted** click (`ElementHandle.click()`, used by
`clickButtonByText` in `test/helpers/browser.ts`) clicks at the element's center
*coordinates*. If the shadcn toast viewport (a body-level portal) overlays those
coordinates, the click lands on the toast, NOT the button — and puppeteer does
**not** raise "not clickable", so `clickButtonByText` returns as if it succeeded.
Result: no form submit, no network request, and a `waitForResponse` later times
out (looks like "no PUT fired" even though amount/button state are all correct).

**Why:** the first submit in a flow usually works (no toast present yet); only the
*second* submit after a toast-producing step fails — making it look state-related
when it is actually a hit-testing/overlay race.

**How to apply:** for a submit that follows a toast-producing step, click the
actual button NODE directly via `page.evaluate(() => btn.click())` (native
`.click()` on a `type="submit"` button submits the form regardless of any
overlay), instead of a coordinate-based trusted click. First `waitForFunction`
that the matching button exists and is enabled. This is what the
client-detail payment stale-reload re-submit does.

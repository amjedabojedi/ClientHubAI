---
name: Radix tab click must verify active
description: A one-shot trusted click on a Radix TabsTrigger can succeed yet not switch the tab; the inactive panel's query never fires.
---

# Radix tab-switch in puppeteer must be retried-until-active

A single trusted `ElementHandle.click()` on a Radix `TabsTrigger` (e.g. a
`clickTabById(page, "tab-owed")` helper) can **return without throwing yet not
actually switch the tab** when the trigger is mid-remount under load. Radix only
mounts the ACTIVE tab's content, so the target panel never mounts, its
`useQuery` never runs, and a `page.waitForResponse(...)` for that panel's GET
(wrapped in `Promise.all` with the tab click) times out — looking like a network
/ selector bug when it's really a missed tab switch.

**Symptom seen:** browser payout test timed out at 45s waiting for
`GET /api/therapist-pay/owed/:id`; a DOM dump at failure showed the therapist
selected and all tabs present, but the active panel was still "Pay Profile"
(the DEFAULT first tab) and **no `/owed` request ever fired**.

**Why:** the click landed on a node that was detaching/re-rendering, so the
trusted event didn't drive Radix's tab change; one-shot helpers don't notice.

**How to apply:** make the tab helper a poll loop — re-query a fresh handle each
pass, click it, then confirm it actually became active
(`data-state="active"` or `aria-selected="true"`) before returning; retry until
an overall deadline. Same spirit as the retrying `clickTab`/`clickButtonByText`
in `test/helpers/browser.ts`. Note the therapist-payments tabs default to
"Pay Profile", NOT "Owed / Record Payout".

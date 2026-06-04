---
name: routes.ts monolith — safe split boundaries
description: How to safely reduce server/routes.ts size without breaking the running app; what is safe vs high-risk to extract.
---

server/routes.ts is a single ~18.9k-line monolith. ALL ~327 route handlers live inside one `registerRoutes(app)` function (the only symbol imported externally, by server/index.ts).

**Safe to extract:** the module-level helper functions defined ABOVE `registerRoutes` — they close over nothing in the request scope. These were pulled into `server/routes-helpers.ts` (email senders, GDPR `checkAIProcessingConsent` fail-closed, privacy redaction `redactClientData/redactSessionClient/redactBillingClient`, `sanitizeUser` which strips `calendarFeedToken`, `formatClientInitial`, `generateClientId`, `convertESTToUTC`, `getBaseUrl`, `calendarFeedRateLimited`, assessment permission checks). Keep the `stripe`/`azureStorage` singletons in routes.ts (routes use them directly).

**High-risk (do NOT bulk-extract without a plan + tests):** the route handlers themselves. They depend on many closures declared INSIDE `registerRoutes`: `notificationService`, booking/recurrence helpers (`checkTimeConflict`, `expandRecurrenceDates`, `acquireBookingLocks`, `evaluateRecurrenceConflicts` + RECURRENCE_* consts + `recurrenceRuleSchema`), the multer `audioUpload`, `assertSessionAccess`, chunk-rate limiters (session + comm), `assertCommunicationClientAccess`, `convertOptionData`, and report helpers (`getPracticeSettingsForReport`, `sanitizeReportHtml`, `userCanAccessClient`, `isAdminRole`). Splitting routes means threading those shared deps into each new module — large, delicate, and there is NO broad integration test (only the app-level `test-privacy` suite).

**Why:** the user is risk-averse ("any risk will crash app or DB"). The helper extraction is compile-time-verified (tsc catches any dangling/missing ref) and the privacy suite (310 tests) covers the redaction/consent paths, so it is provably safe. The route-group split is not similarly guarded.

**How to apply (future route split):** go ONE cohesive group at a time → make a `server/routes/<group>.ts` exporting `register<Group>Routes(app, deps)` → pass shared closures in via a deps object → typecheck + boot smoke (GET / => 200, /api/auth/me => 401) + run test-privacy after EACH group. storage.ts (~6.1k) is a single class — hard to split safely; client-detail.tsx (~6.1k) splits by extracting tab panels but risks that page's state wiring.

# SmartHub

SmartHub is a comprehensive therapy practice management application that streamlines client handling, scheduling, documentation, billing, and assessments for mental health professionals.

## Run & Operate

**Run Development:**
```bash
npm run dev # Starts client and server
```

**Build Client:**
```bash
npm run build:client
```

**Build Server:**
```bash
npm run build:server
```

**Typecheck:**
```bash
npm run check
```

**Generate Drizzle Migrations:**
```bash
npm run db:generate
```

**Push DB Migrations:**
```bash
npm run db:push
```

**Run Privacy/Regression Test Suite:**
```bash
bash scripts/run-privacy-tests.sh
```
Runs all privacy/regression suites serially and prints a pass/fail summary plus per-suite durations. It also tracks each suite's recent runtimes in `.local/privacy-test-durations.json` (a rolling list of the last few runs per suite) and flags suites that get significantly slower than their **rolling-median baseline**.

Using the median of recent runs (instead of just the single previous run) makes detection robust to a one-off slow run: a single noisy outlier barely moves the median, so it can't drag the baseline up or down on its own.

Set `FAIL_ON_SLOWDOWN=1` to make a **sustained** slow-down fail the run (default is warning-only):
```bash
FAIL_ON_SLOWDOWN=1 bash scripts/run-privacy-tests.sh
```
A slow-down only fails the run when it **persists across two consecutive runs** — both the current run and the immediately previous recorded run must be more than the threshold (50%) slower than the median baseline. A single noisy run (scheduling jitter on the shared CI machine) is reported as an informational warning but never fails the build, because the run before it was normal. A genuine, sustained slow-down trips two runs in a row and fails as intended.

The baseline a run is judged against is the median of a suite's **older** recorded runs, explicitly excluding the most recent recorded run, so a fresh slow sample can't re-anchor the baseline and hide itself. At least a few older data points are required before anything is flagged.

The CI `test-privacy` workflow runs with `FAIL_ON_SLOWDOWN=1` enabled, so sustained performance regressions fail the run automatically. Early runs on a fresh checkout have no baseline (the history file is untracked working state), so nothing can be flagged until history accumulates — those early runs always pass.

The detection logic itself lives in `scripts/lib/slowdown-detect.sh` and is covered by deterministic tests in `test/slowdown-detection.test.sh` (run directly with `bash test/slowdown-detection.test.sh`). The privacy runner also runs this self-test first and aborts early if the detector logic is broken.

**Required Environment Variables:**
`DATABASE_URL`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `SENDGRID_API_KEY`, `AZURE_STORAGE_CONNECTION_STRING`

## Stack

**Frontend:** React 18+ (TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, Tailwind CSS)
**Backend:** Node.js (Express, TypeScript, Drizzle ORM, PostgreSQL)
**ORM:** Drizzle ORM
**Validation:** Zod
**Build Tool:** Vite (frontend), ESBuild (backend)

## Where things live

-   `/client`: Frontend React application
-   `/server`: Backend Node.js API
-   `/shared`: Common types and utilities
-   `/migrations`: Database schema migrations
-   **DB Schema:** `/shared/src/db/schema.ts`
-   **API Contracts:** Defined implicitly by Zod schemas in API routes.
-   **Theme Files:** `/client/tailwind.config.js`, `/client/src/index.css` (Shadcn/ui theming)

## Architecture decisions

-   **Database & ORM:** Drizzle ORM with Neon PostgreSQL for type-safe, relational data modeling.
-   **Authentication:** Cookie-based session authentication with role-based access control (admin, supervisor, therapist, billing, client) for HIPAA compliance.
-   **AI Integration:** OpenAI GPT-4o for clinical content generation (session notes, assessment reports), enforced with a human review workflow and GDPR consent management.
-   **Clinical Forms:** Digital form system with `formTemplates`, `formFields`, `formAssignments`, `formResponses`, and audit-logged `formSignatures`.
-   **Document Storage:** Azure Blob Storage for scalable and compliant document storage.

## Product

-   **Client Management:** Comprehensive client lifecycle tracking, profiles, onboarding, portal access, and bulk management.
-   **Clinical Documentation:** Session management, AI-assisted session notes, voice transcription for sessions, and assessment management with AI-generated reports.
-   **Billing & Finance:** Automated invoicing, payment tracking (Stripe integration), and flexible discount system.
-   **Scheduling:** Therapist availability, blocked times, room management, and conflict prevention.
-   **Client Portal:** Self-service for appointments, documents, invoices, and notification preferences.
-   **Clinical Content Library:** Reusable content with "Smart Connect" for contextual suggestions and bulk import.
-   **Audit & Compliance:** Robust audit logging for HIPAA compliance, GDPR consent management for AI processing.

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

-   Always run `npm run db:generate` after schema changes before `npm run db:push`.
-   Ensure all environment variables are set for both client and server to function correctly.
-   AI consent for clients must be explicitly granted for AI features to process their data; otherwise, therapists must document manually.
-   Session voice-recording uploads must call `POST /api/sessions/:sessionId/transcribe-start` first to obtain a server-minted opaque `uploadId` (prefixed `srv-`) — the `transcribe-chunk` endpoint rejects any other id and is rate-limited to 120 chunk uploads per 10 minutes per (user, session).

## Pointers

-   **React Documentation:** https://react.dev/
-   **Node.js Documentation:** https://nodejs.org/docs/latest/api/
-   **Drizzle ORM Documentation:** https://orm.drizzle.team/
-   **TanStack Query Documentation:** https://tanstack.com/query/latest
-   **Shadcn/ui Documentation:** https://ui.shadcn.com/
-   **Tailwind CSS Documentation:** https://tailwindcss.com/docs
-   **OpenAI API Documentation:** https://platform.openai.com/docs/api-reference
-   **Stripe API Documentation:** https://stripe.com/docs/api
-   **Zod Documentation:** https://zod.dev/
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
npm run typecheck
```

**Generate Drizzle Migrations:**
```bash
npm run db:generate
```

**Push DB Migrations:**
```bash
npm run db:push
```

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
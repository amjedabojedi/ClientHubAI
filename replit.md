# Overview

SmartHub is a comprehensive therapy practice management application designed for mental health professionals. It offers end-to-end management including client handling, scheduling, session documentation, billing, assessments, and a client portal. The system focuses on clinical workflow automation, HIPAA compliance, and integrates AI (OpenAI GPT-4o) for intelligent features. It aims to serve therapists, administrators, and clients with role-based access, automated billing, AI-assisted documentation, and thorough audit logging.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Technology Stack

**Frontend:** React 18+ with TypeScript, Vite, Wouter for routing, TanStack Query for state management, Shadcn/ui (Radix UI primitives), Tailwind CSS.
**Backend:** Node.js with Express, TypeScript, Drizzle ORM, PostgreSQL (Neon serverless), cookie-based authentication with bcrypt.
**Build & Deployment:** ESBuild for server bundling, separate client/server builds, environment-based configuration.

## Application Structure

The codebase is a monorepo:
- `/client`: Frontend React application.
- `/server`: Backend Express API, including route definitions, database access, and PDF generation utilities.
- `/shared`: Code shared between client and server, primarily database schema definitions.
- `/migrations`: Database migration files.

## Core Architectural Decisions

### Database & ORM Strategy
**Decision:** Drizzle ORM with PostgreSQL.
**Rationale:** Type-safe queries, strong TypeScript integration, robust relational data modeling for healthcare records.
**Implementation:** Schema in `/shared/schema.ts`, `PostgresStorage` class for abstraction, `drizzle-kit` for migrations, Neon serverless for connection pooling.

### Authentication & Authorization
**Decision:** Cookie-based session authentication with role-based access control.
**Rationale:** Secure, stateless authentication suitable for healthcare; role-based permissions ensure HIPAA compliance.
**Implementation:** bcrypt for password hashing, HTTP-only cookies for session tokens, JWT for session management, roles (admin, supervisor, therapist, billing, client), middleware for route protection.

### Client-Server Communication
**Decision:** RESTful API with JSON payloads.
**Rationale:** Well-understood, stateless pattern; JSON simplifies data serialization with TypeScript.
**Implementation:** Routes organized by resource, consistent response format with error handling, Zod for request validation, TanStack Query for caching.

### File Storage
**Decision:** Migration from Replit Object Storage to Azure Blob Storage for enterprise-grade scalability and compliance.
**Implementation:** Uses `@azure/storage-blob` SDK, documents stored with `documents/{id}-{filename}` convention, metadata in `documents` table.

### PDF Generation
**Decision:** Dual-strategy based on delivery method.
**Implementation:**
1.  **Browser Print Dialog:** For downloads/printing (session notes, reports, invoices). Server generates HTML, frontend opens in new window with print dialog. Benefits: Reliability, perfect formatting.
2.  **Server-side Puppeteer:** For email attachments (invoice emails). Uses `puppeteer` to generate PDF buffer. Includes graceful degradation if PDF generation fails.

### AI Integration
**Decision:** OpenAI GPT-4o for clinical content generation.
**Rationale:** Advanced language understanding for clinically appropriate documentation.
**Use Cases:** AI-assisted session notes, assessment report interpretation, general report generation.
**Implementation:** Custom prompts, human review workflow (draft → review → finalize).

## Data Model Design

### Client Lifecycle Management
Tracks clients through stages (intake, assessment, active_therapy, maintenance, discharged) and statuses (active, inactive, pending). Includes comprehensive profiles, onboarding checklists, and portal access. Features multi-level duplicate detection with AI-powered recommendations for merging records, and an "unmark" functionality.

**Bulk Client Management (Added November 2025):**
Comprehensive bulk operations system for mass client updates with role-based access control.

**Permission Model:**
- **Admin:** Full access to all bulk operations across all clients
- **Supervisor:** Access to bulk operations for clients assigned to supervised therapists only (no portal access changes)
- **Therapist:** No access to bulk operations (checkboxes hidden, actions disabled)

**Bulk Operations:**
1. **Stage Changes:** Update lifecycle stage for multiple clients simultaneously
2. **Therapist Reassignment:** Reassign clients to one or multiple therapists with smart workload distribution
3. **Portal Access Toggle:** Enable/disable client portal access (admin only, requires email validation)
4. **Status Updates:** Change client status (active/inactive/pending) in bulk

**Key Features:**
- Filter-based client selection with select-all support
- Database-driven options from `system_options` table (not hardcoded)
- Smart workload distribution algorithm for balanced therapist assignment
- Comprehensive audit logging for all bulk operations
- Detailed success/skip/error reporting with user-friendly toast notifications
- Input validation prevents empty submissions
- Scope enforcement ensures supervisors only affect their team

### Clinical Documentation
**Session Management:** `sessions` table links clients, therapists, services, rooms; auto-billing on completion.
**Session Notes:** `session_notes` table for AI-generated drafts, progress tracking, goal documentation.
**Assessments:** `assessment_templates`, `assessment_assignments`, `assessment_responses`, and AI-generated `assessment_reports`.

**Clinical Content Library (Enhanced November 2025):**
Comprehensive library system for reusable clinical content with smart connections and bulk import.

**Title Pattern System:**
Library entries follow a structured coding pattern: `[CONDITION][TYPE][NUMBER]_[VARIANT]`
- **CONDITION:** 3-5 letter code (ANX=Anxiety, DEPR=Depression, TRAUM=Trauma, PTSD, ADHD, etc.)
- **TYPE:** Single letter identifying entry purpose
  - S = Symptom (parent/root entry)
  - I = Intervention (treatment options)
  - P = Progress (outcome measures)
  - G = Goal (target outcomes)
- **NUMBER:** Pathway number (1-99) linking related entries
- **VARIANT:** Optional variant number (_1, _2, _3) for multiple options

Examples: `ANXS10` (Anxiety Symptom #10), `ANXI10_2` (Anxiety Intervention for pathway 10, variant 2), `ANXP10_1` (Progress measure for pathway 10)

**Smart Connect Feature:**
Intelligent auto-suggestion system for creating connections between library entries:
1. **Pattern-Based Matching (100% confidence):** Automatically detects entries in the same pathway by parsing title codes. If creating `ANXI10_2`, suggests connecting to `ANXS10`, `ANXI10_1`, `ANXI10_3`, `ANXP10_1`, `ANXG10`.
2. **Keyword Fallback (60% confidence):** For non-pattern titles, uses keyword matching across titles and tags with category relationships.
3. **Connection Types:** Automatically determines relationship type based on entry types (S→I = "treats", I→P = "measures", S→G = "targets", I→I = "alternative_to").

**Bulk Import:**
- Copy-paste from Excel with TAB or comma separator support
- Two-column format: Title, Content
- Real-time validation and preview with error detection
- Batch creation with success/error reporting
- Bulk entries accessible via "Bulk Add" button per category

**Duplicate Prevention (Added November 2025):**
- Case-insensitive title matching prevents duplicate library entries
- Single entry creation returns 409 error if title already exists
- Bulk import skips duplicates and reports them separately (successful/skipped/failed)
- Database cleaned from 254 to 176 unique entries (78 duplicates removed)

### Billing & Financial Tracking
Automated workflow from service selection to invoice generation and payment tracking.
**Key Tables:** `services`, `session_billing`, `invoices`, `payments`.
**Stripe Integration:** For online payments and webhook handling.

**Discount Functionality (Added November 2025):**
Flexible discount system for billing with two discount types:
- **Percentage Discount:** Apply a percentage off the service amount (e.g., 10% off)
- **Fixed Amount Discount:** Apply a fixed dollar amount off (e.g., $25 off)

**Implementation:**
- Three new fields in `session_billing`: `discount_type`, `discount_value`, `discount_amount`
- Real-time discount calculation in payment recording UI
- Discounts display on invoices in green between subtotal and insurance coverage
- Invoice calculation order: Subtotal → Discount → Insurance Coverage → Copay → Payments → Total Due
- Full persistence support: load existing discounts when editing, clear discounts when "No discount" selected
- Both admin and client portal invoices show applied discounts

### Audit & Compliance
**Decision:** Comprehensive audit logging for HIPAA compliance.
**Implementation:** `audit_logs` table captures significant actions (user, action type, resource, timestamp, IP).

## Scheduling & Availability
Manages therapist working hours, blocked times, and room availability. Includes conflict prevention and capacity tracking.

## Client Portal
Self-service interface for clients: appointment booking, document management (uploads/downloads), invoice viewing/payment, notification preferences. Separate authentication and limited data access.

# External Dependencies

## Third-Party Services
-   **OpenAI API:** GPT-4o for clinical content generation (session notes, assessment reports).
-   **Stripe:** Payment processing for client invoices.
-   **SendGrid:** Transactional emails (reminders, notifications, invoices).
-   **Azure Blob Storage:** Document storage (replacing Replit Object Storage).

## Database
-   **Neon PostgreSQL:** Serverless PostgreSQL hosting with connection pooling.

## UI Component Libraries
-   **Radix UI:** Headless accessible component primitives (Dialog, Dropdown, etc.).
-   **Shadcn/ui:** Pre-built component library built on Radix UI, themed with Tailwind CSS.

## Development Tools
-   **PostHog:** Product analytics and user tracking.
-   **Puppeteer/Chromium:** Server-side PDF generation.

## Build & Development
-   **Vite:** Frontend development server and build tool.
-   **TypeScript:** Type checking across client and server.
-   **Drizzle Kit:** Database migration management.
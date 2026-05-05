# Overview

SmartHub is a comprehensive therapy practice management application for mental health professionals. It provides end-to-end management of client handling, scheduling, session documentation, billing, assessments, clinical forms, and a client portal. The system prioritizes clinical workflow automation, HIPAA compliance, and integrates AI (OpenAI GPT-4o) for intelligent features. SmartHub aims to serve therapists, administrators, and clients with role-based access, automated billing, AI-assisted documentation, and thorough audit logging.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Technology Stack

**Frontend:** React 18+ (TypeScript, Vite, Wouter, TanStack Query, Shadcn/ui, Tailwind CSS).
**Backend:** Node.js with Express (TypeScript, Drizzle ORM, PostgreSQL), cookie-based authentication.
**Build & Deployment:** ESBuild for server bundling, separate client/server builds, environment-based configuration.

## Application Structure

The codebase is a monorepo with distinct directories for `/client` (frontend), `/server` (backend API), `/shared` (common code, e.g., database schema), and `/migrations`.

## Core Architectural Decisions

### Database & ORM Strategy
Drizzle ORM with PostgreSQL (Neon serverless) for type-safe queries and robust relational data modeling.

### Authentication & Authorization
Cookie-based session authentication with role-based access control (admin, supervisor, therapist, billing, client) for security and HIPAA compliance.

### Client-Server Communication
RESTful API with JSON payloads and Zod for validation, utilizing TanStack Query for efficient data fetching and caching.

### File Storage
Azure Blob Storage for scalable and compliant document storage, replacing previous solutions.

### Clinical Forms System
A digital form system for informed consent, intake, ROI, and treatment agreements, including electronic signatures. Forms utilize `formTemplates` (with soft delete), `formFields` (supporting 8 types), `formAssignments` with status tracking, `formResponses` (encrypted in Phase 2), and `formSignatures` with audit trails.

### Document Review Workflow
When uploading a document, users can flag it for therapist review, supervisor review, or both. Clinical categories (referral, insurance, consent, lab, etc.) are auto-suggested for review. On upload, targeted in-app notifications and emails are sent only to flagged reviewers. Each document displays a Pending Review / Reviewed / Rejected status badge. A "Mark as Reviewed" button opens a dialog where reviewers choose Approve or Reject and add optional notes. A background job runs hourly to send 24-hour reminders for unreviewed documents. Supervisor assignments are pulled from the existing `supervisorAssignments` table.

### PDF Generation
A dual strategy using browser print dialogs for user downloads and server-side Puppeteer for automated PDF generation (e.g., email attachments).

### AI Integration
OpenAI GPT-4o is integrated for clinical content generation, including AI-assisted session notes and assessment report interpretation, with a human review workflow.

### GDPR Consent Management
A comprehensive consent system allows clients to control AI processing of their data through the client portal. Clients can grant or withdraw consent for four categories: AI processing, data sharing, research participation, and marketing communications. The system uses fail-closed validation (denies processing on errors) to ensure GDPR compliance. All consent changes are logged with comprehensive audit metadata including IP address, consent version, and timestamps. Backend enforcement prevents AI processing without explicit consent - when clients opt out, therapists can still use all SmartHub features but must document manually instead of using AI assistance. Consent is enforced at 4 major AI endpoints: template generation, session note regeneration, assessment report generation, and voice transcription. All blocked AI processing attempts are logged with full audit trails for HIPAA compliance.

## Data Model Design

### Client Lifecycle Management
Comprehensive client management includes tracking through various stages and statuses, detailed profiles, onboarding, portal access, and multi-level duplicate detection. Features bulk client management with role-based access for stage changes, therapist reassignment, portal access toggling, and status updates, all with audit logging and detailed reporting.

### Clinical Documentation

**Session Management:** Tracks sessions linking clients, therapists, services, and rooms, with auto-billing.
**Session Notes:** Stores AI-generated drafts and progress notes.

**Session Voice Transcripts (Phase 1):** Therapists can record full therapy sessions (hour-long supported) directly from the Session Note dialog using a chunked client-side recorder. Recording is sliced into 60-second segments; each segment is uploaded as soon as it ends to `POST /api/sessions/:sessionId/transcribe-chunk` (Whisper API), discarded after transcription, and a live preview of recognised text streams back. On Stop, `POST /api/sessions/:sessionId/transcribe-finalize` stitches the chunks, runs GPT-4o speaker diarization (Therapist:/Client: labels), and saves the result to the dedicated `session_transcripts` table (one transcript per session). The transcript is stored as a separate document — it is **not** auto-pasted into the session note; therapists copy/paste the relevant portions themselves. AI consent (GDPR) is enforced before any chunk is transcribed; HIPAA audit logs capture creation, view, and deletion. Pause/resume supported. No audio is persisted server-side. Per-session authorization (assigned therapist, supervisor, or admin only) is enforced on every transcript endpoint. A standalone **View Transcript** action lives in the session card's dropdown menu on the Client Detail page, opening `SessionTranscriptViewer` which fetches the saved transcript and offers Copy / Download .txt / Delete actions.

**Smart Fill from Transcript:** When a saved transcript exists, the Session Note dialog's `SessionRecorder` shows a "Smart Fill Note Fields" action. It calls `POST /api/sessions/:sessionId/transcript/smart-fill` which (after `requireAuth`, `assertSessionAccess`, and fail-closed AI consent check) reads the existing transcript and runs `extractStructuredNoteFromTranscript` (GPT-4o, JSON mode, strict no-hallucination prompt, input capped at 12k words) to produce 7 structured suggestions: sessionFocus, symptoms, shortTermGoals, intervention, progress, remarks, recommendations. The endpoint never writes to `session_notes`. The `TranscriptSmartFillDialog` lets the therapist edit each suggestion, pick which fields to apply via per-field checkbox, and shows the current note value side-by-side with a "Will overwrite existing" badge. Selected fields are pushed into the form via `setValue(..., { shouldDirty: true })`. Both blocked-by-consent and successful runs are HIPAA-audit-logged. Zero schema impact (no new columns/tables). The previous floating blue mic button (`FloatingVoiceButton` / `VoiceRecorder` / `TranscriptionReviewDialog` flow) has been removed in favor of this transcript-driven flow.
**Assessments:** Manages assessment templates, assignments, responses, and AI-generated reports. Assessment responses use option IDs (not array indices) for proper scoring and AI report generation. Backend normalization layer handles legacy index-based data during transition.

**Assessment Completion Enhancements:**
- **Voice Recording with Transcription:** Text field responses support optional voice recording using OpenAI Whisper for transcription, with optional Arabic-to-English translation. Users can record, transcribe, and insert text directly into assessment fields.
- **Section-by-Section Review:** Users can review a comprehensive summary of all sections before finalizing, with "Review Summary" button opening a modal dialog showing completion stats for each section (total questions, answered, required completion status).
- **Quick Section Editing:** "Edit Section" buttons in the summary modal allow jumping directly to specific sections for modifications without losing progress.
- **Draft Report Editing:** Assessment report page includes "Edit Assessment Responses" button (visible when report is in draft status) to easily navigate back and modify responses, supporting iterative refinement of assessments.

**Clinical Content Library:** A comprehensive system for reusable clinical content. It uses a structured title pattern (`[CONDITION][TYPE][NUMBER]_[VARIANT]`) for categorization. A "Smart Connect" feature auto-suggests connections between entries based on patterns and keywords, defining relationship types. The system supports bulk import from Excel/CSV with multi-column support: users paste data, the system auto-detects columns, and users map them to Domain, Subdomain, Composite (title), and Content. The backend (`POST /api/library/bulk-entries`) auto-creates/resolves the category hierarchy (Domain → Subdomain) from the mapped names, with duplicate entry prevention and validation. Supports both legacy single-category mode (with `categoryId`) and the new domain-based auto-resolution mode.

**Relationship-Based Filtering:** The Library Picker in Session Notes intelligently filters content based on previously selected entries (Symptoms, Goals, Interventions, Progress), showing only relevant connected entries within the current category. This uses a bulk connection endpoint and TanStack Query for performance.

**Connection Duplicate Prevention:** Ensures unique and bidirectional connections between library entries using canonical ordering and a batch connection endpoint, providing informative feedback on created and skipped connections.

### Billing & Financial Tracking
Automated workflow from service selection to invoice generation and payment tracking, integrated with Stripe. Includes a flexible discount system supporting percentage and fixed-amount discounts, which are displayed on invoices.

### Audit & Compliance
A robust `audit_logs` table captures significant user actions for HIPAA compliance.

## Scheduling & Availability
Manages therapist working hours, blocked times, and room availability, including conflict prevention.

## Client Portal
A self-service interface for clients to book appointments, manage documents, view/pay invoices, and manage notification preferences, with separate authentication.

# External Dependencies

## Third-Party Services
-   **OpenAI API:** GPT-4o for AI-driven clinical content generation.
-   **Stripe:** Payment processing.
-   **SendGrid:** Transactional email services.
-   **Azure Blob Storage:** Cloud storage for documents.

## Database
-   **Neon PostgreSQL:** Serverless PostgreSQL database hosting.

## UI Component Libraries
-   **Radix UI:** Headless accessible UI component primitives.
-   **Shadcn/ui:** Themed component library built on Radix UI and Tailwind CSS.

## Development Tools
-   **PostHog:** Product analytics and user tracking.
-   **Puppeteer/Chromium:** Server-side PDF generation.

## Build & Development
-   **Vite:** Frontend build tool.
-   **TypeScript:** Language for type-checking.
-   **Drizzle Kit:** Database migration management.
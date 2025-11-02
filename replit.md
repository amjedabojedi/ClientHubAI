# Overview

SmartHub (previously TherapyFlow/ClientHubAI) is a comprehensive therapy practice management application designed for mental health professionals. It provides end-to-end practice management including client management, scheduling, session documentation, billing, assessments, and a client portal. The system emphasizes clinical workflow automation, HIPAA compliance, and intelligent features powered by AI (OpenAI GPT-4o).

The application serves therapists, administrators, and clients with role-based access controls, automated billing workflows, AI-assisted clinical documentation, and comprehensive audit logging.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Technology Stack

**Frontend:**
- React 18+ with TypeScript
- Vite as build tool and development server
- Wouter for client-side routing
- TanStack Query (React Query) for server state management
- Shadcn/ui components with Radix UI primitives
- Tailwind CSS for styling

**Backend:**
- Node.js with Express
- TypeScript for type safety
- Drizzle ORM for database interactions
- PostgreSQL as primary database (Neon serverless)
- Cookie-based authentication with bcrypt password hashing

**Build & Deployment:**
- ESBuild for production server bundling
- Separate client and server build processes
- Environment-based configuration

## Application Structure

The codebase follows a monorepo structure with clear separation:

```
/client          - Frontend React application
  /src
    /components  - Reusable UI components
    /pages       - Route-level page components
    /hooks       - Custom React hooks
    /lib         - Utility functions and helpers
/server          - Backend Express API
  /routes.ts     - API endpoint definitions
  /storage.ts    - Database access layer
  /pdf/          - PDF generation utilities
/shared          - Code shared between client and server
  /schema.ts     - Database schema definitions
/migrations      - Database migration files
```

## Core Architectural Decisions

### Database & ORM Strategy

**Decision:** Use Drizzle ORM with PostgreSQL
**Rationale:** Drizzle provides type-safe database queries with excellent TypeScript integration while maintaining flexibility and performance. PostgreSQL offers robust relational data modeling needed for healthcare records.

**Implementation:**
- Schema defined in `/shared/schema.ts` using Drizzle's schema builder
- Database access abstracted through `PostgresStorage` class in `/server/storage.ts`
- Migrations managed via `drizzle-kit` with configuration in `drizzle.config.ts`
- Connection pooling with Neon serverless driver (`@neondatabase/serverless`)

### Authentication & Authorization

**Decision:** Cookie-based session authentication with role-based access control
**Rationale:** Cookies provide secure, stateless authentication suitable for healthcare applications. Role-based permissions ensure proper data access controls for HIPAA compliance.

**Implementation:**
- Password hashing with bcrypt (10 rounds)
- HTTP-only cookies for session tokens
- JWT tokens for session management
- User roles: admin, supervisor, therapist, billing, client
- Middleware-based route protection (`requireAuth`, `requireRole`)
- User identification stored in `req.user` after authentication

**Security Considerations:**
- Secure cookie flags in production
- CSRF protection through same-site cookie policy
- Password strength validation on registration
- Session expiration and refresh mechanisms

### Client-Server Communication

**Decision:** RESTful API with JSON payloads
**Rationale:** REST provides a well-understood, stateless communication pattern. JSON simplifies data serialization and integrates naturally with TypeScript types.

**API Structure:**
- Routes organized by resource (`/api/clients`, `/api/sessions`, `/api/billing`)
- Consistent response format with error handling
- Request validation using Zod schemas
- TanStack Query on frontend for caching and optimistic updates

### File Storage Migration

**Decision:** Migrating from Replit Object Storage to Azure Blob Storage
**Rationale:** Production deployment requires enterprise-grade, scalable storage solution with proper access controls and compliance features.

**Current State:**
- Legacy code uses `@replit/object-storage` 
- Migration scripts present (`azure-migration-log.txt`, `azure-direct-upload-log.txt`)
- New implementation uses `@azure/storage-blob` SDK
- Document metadata stored in database with blob URL references

**Storage Pattern:**
- Documents stored with naming convention: `documents/{id}-{filename}`
- Metadata tracked in `documents` table (file size, MIME type, client association)
- Download tracking and access logging
- Support for multiple file types (PDF, DOCX, images)

### PDF Generation

**Decision:** Dual-strategy PDF generation based on use case
**Rationale:** Different delivery methods require different technical approaches for reliability and user experience.

**Implementation - Two Strategies:**

1. **Browser Print Dialog (Downloads/Printing):**
   - Used for: Session notes, assessment reports, invoice downloads
   - Server generates professional HTML with embedded styles
   - Frontend opens HTML in new window with print dialog
   - User saves as PDF using native browser print-to-PDF
   - Benefits: 100% reliable, no server dependencies, perfect formatting
   - Files: `server/pdf/session-note-pdf.ts`, `server/pdf/assessment-report-pdf.ts`

2. **Server-side Puppeteer (Email Attachments):**
   - Used for: Invoice emails with PDF attachment
   - Uses `puppeteer` with hardcoded Chromium path on Replit
   - Generates actual PDF buffer for email attachment
   - Graceful degradation: If PDF fails, sends HTML email without attachment
   - Retry logic for timeout errors

**Key Endpoints:**
- `/api/clients/:clientId/invoice` - Admin billing invoice (action: 'download' = HTML, 'email' = PDF)
- `/api/portal/invoices/:invoiceId/receipt` - Client portal receipt (action: 'preview' = HTML)
- Session notes and assessment reports - Always return HTML for browser print

**Technical Details:**
- Chromium path: `/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium`
- Email PDFs require actual file attachment (can't use browser print)
- Download PDFs work better with browser print (no server resource constraints)

### AI Integration

**Decision:** OpenAI GPT-4o for clinical content generation
**Rationale:** GPT-4o provides advanced language understanding necessary for generating clinically appropriate documentation while maintaining professional standards.

**Use Cases:**
1. **Session Notes:** AI-assisted clinical documentation based on therapist inputs
2. **Assessment Reports:** Automated interpretation of psychological assessment responses
3. **Report Generation:** Professional narrative reports from structured data

**Implementation:**
- API key stored in environment variables
- Custom prompts for clinical context
- Third-person professional narrative formatting
- Human review workflow (draft → review → finalize)

## Data Model Design

### Client Lifecycle Management

The system tracks clients through distinct stages with comprehensive profile data:

**Client Stages:** intake → assessment → active_therapy → maintenance → discharged
**Client Status:** active, inactive, pending

**Key Tables:**
- `clients` - Core demographic and contact information
- `userProfiles` - Extended therapist and client profile data
- `client_checklists` - Onboarding task tracking
- `client_portal_access` - Portal authentication credentials

### Clinical Documentation

**Session Management:**
- `sessions` table links clients, therapists, services, and rooms
- Automatic billing record creation when session completed
- Session types: psychotherapy, assessment, consultation, group
- Status tracking: scheduled → completed → billed

**Session Notes:**
- `session_notes` table for clinical documentation
- AI-generated drafts with human finalization workflow
- Progress tracking, goal documentation, clinical observations
- Timestamp tracking for creation, updates, finalization

**Assessments:**
- `assessment_templates` - Reusable assessment structures (admin-created)
- `assessment_sections` - Template sections with question definitions
- `assessment_assignments` - Client-specific assessment instances
- `assessment_responses` - Client answers to assessment questions
- `assessment_reports` - AI-generated clinical reports

### Billing & Financial Tracking

**Automated Billing Workflow:**
1. Service selection determines CPT code, duration, rate
2. Session completion triggers automatic billing record creation
3. Invoice generation with insurance/copay calculation
4. Payment tracking and status management

**Key Tables:**
- `services` - CPT codes, duration, base rates
- `session_billing` - Per-session billing records
- `invoices` - Client invoices with payment tracking
- `payments` - Payment transactions and history

**Stripe Integration:**
- Payment processing via `@stripe/stripe-js` and `@stripe/react-stripe-js`
- Webhook handling for payment events
- Support for online payments through client portal

### Audit & Compliance

**Decision:** Comprehensive audit logging for HIPAA compliance
**Implementation:**
- `audit_logs` table captures all significant actions
- Records: user, action type, resource, timestamp, IP address
- Failed audit log attempts logged to console (see error examples in logs)
- Currently has foreign key constraint issues requiring resolution

## Scheduling & Availability

**Therapist Availability:**
- Working days and hours stored in `userProfiles.workingHours` (JSON)
- Blocked time management via `therapistBlockedTimes` table
- Support for recurring blocks (meetings, training)
- Maximum clients per day configuration

**Room Management:**
- `rooms` table for physical/virtual spaces
- Conflict prevention through booking validation
- Capacity tracking and availability checking

## Client Portal

**Purpose:** Self-service interface for clients to manage appointments, view documents, and make payments

**Features:**
- Appointment booking within therapist availability
- Document uploads and downloads
- Invoice viewing and online payment
- Notification preferences
- Separate authentication from admin portal

**Implementation:**
- Dedicated routes under `/api/portal/*`
- Portal-specific authentication cookies
- Limited data access scoped to client's own records

# External Dependencies

## Third-Party Services

**OpenAI API:**
- Model: GPT-4o
- Purpose: Clinical content generation (session notes, assessment reports)
- Configuration: API key in environment variables
- Usage: Automated clinical documentation, assessment interpretation

**Stripe:**
- Purpose: Payment processing for client invoices
- Integration: React Stripe.js for frontend, Stripe API for backend
- Webhooks: Payment confirmation and status updates

**SendGrid:**
- Package: `@sendgrid/mail`
- Purpose: Transactional emails (appointment reminders, notifications, invoice delivery)
- Configuration: API key in environment variables

**Azure Blob Storage:**
- Package: `@azure/storage-blob`
- Purpose: Document storage (replacing Replit Object Storage)
- Configuration: Connection string and container name in environment
- Migration: In progress (see migration logs)

## Database

**Neon PostgreSQL:**
- Serverless PostgreSQL hosting
- Package: `@neondatabase/serverless`
- Connection: Via `DATABASE_URL` environment variable
- Features: Connection pooling, automatic scaling

## UI Component Libraries

**Radix UI:**
- Headless accessible component primitives
- Components: Dialog, Dropdown, Select, Tooltip, Toast, etc.
- Styling: Custom Tailwind CSS integration

**Shadcn/ui:**
- Pre-built component library built on Radix UI
- Configuration: `components.json` defines paths and theming
- Theme: New York style with CSS variables for colors

## Development Tools

**PostHog:**
- Purpose: Product analytics and user tracking
- Integration: Page view tracking, event capture
- Configuration: API key and host in environment variables
- User identification: Linked to authenticated users

**Puppeteer/Chromium:**
- Package: `puppeteer-core` with `@sparticuz/chromium`
- Purpose: Server-side PDF generation
- Challenges: Resource constraints, timeout issues (see error logs)

## Build & Development

**Vite:**
- Frontend development server and build tool
- Plugins: React, runtime error overlay, Replit cartographer (dev only)
- Configuration: `vite.config.ts` with path aliases

**TypeScript:**
- Type checking across client and server
- Shared types via `/shared` directory
- Configuration: `tsconfig.json` with strict mode enabled

**Drizzle Kit:**
- Database migration management
- Commands: `db:push` for schema synchronization
- Configuration: `drizzle.config.ts`
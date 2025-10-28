# TherapyFlow

## Overview
TherapyFlow is a comprehensive full-stack therapy practice management application designed to streamline operations for healthcare professionals. It manages client information, scheduling, documentation, and administrative tasks, aiming to enhance efficiency and organization in clinical settings through features like client management, advanced scheduling, AI-assisted note generation, and billing integration.

## User Preferences
Preferred communication style: Simple, everyday language.
Code organization: Keep code clean and well-organized when making changes.
Application name: TherapyFlow (to be used consistently throughout the application).

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query (React Query)
- **UI Framework**: Radix UI components with custom styling
- **Styling**: Tailwind CSS with CSS variables
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite
- **Design Principles**: Responsive (mobile-first), clean visual hierarchy, professional UI, color-coded indicators.
- **Timezone Handling**: ALL dates and times consistently use `America/New_York` (EST/EDT) for display and input, while storing in UTC in the database.
- **Date Formatting Standards**: Centralized in `client/src/lib/datetime.ts` with consistent formats:
  - **Date Display**: `MMM dd, yyyy` (e.g., "Jan 15, 2025") via `formatDateDisplay()`
  - **Date with Time**: `MMM dd, yyyy 'at' h:mm a` (e.g., "Jan 15, 2025 at 2:30 PM") via `formatDateTimeDisplay()`
  - **Full Month**: `MMMM dd, yyyy` (e.g., "January 15, 2025") via `formatDateFull()`
  - **Input Fields**: `yyyy-MM-dd` (e.g., "2025-01-15") via `formatDateInput()`
  - **Audit Logs**: `MMM dd, yyyy HH:mm:ss` (e.g., "Jan 15, 2025 14:30:45") via `formatDateAudit()`
  - All formatting functions handle null/undefined values gracefully and always use America/New_York timezone

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js for REST API
- **Database ORM**: Drizzle ORM
- **Session Management**: Express sessions with PostgreSQL storage
- **API Design**: RESTful endpoints with CRUD operations.
- **Security**: Role-based access control (15 granular permissions), data isolation, `requireAuth` middleware, authorization derived from `req.user` session context.

### Database
- **Database**: PostgreSQL (configured for Neon serverless)
- **ORM**: Drizzle ORM with schema-first approach
- **Migrations**: Drizzle Kit
- **Connection**: Connection pooling with `@neondatabase/serverless`
- **Data Models**: Clients, Users, Sessions, Tasks, Notes, Documents, System Options, Library, Assessment Templates, Checklist Templates, Supervisor Assignments.
- **Scalability**: Optimized for 5000+ client records.

### Key Features
- **Client Management**: Comprehensive profiles, status tracking, search/filtering, bulk operations, direct scheduling.
- **Scheduling & Calendar**: Multi-view calendar, session management, role-based access, in-place editing.
- **Session Notes**: Mood tracking, goals, interventions, clinical documentation, rich text editing (ReactQuill), AI-assisted generation.
- **System Options Management**: Dynamic, database-driven configuration for all dropdown options.
- **Bulk Data Operations**: Bulk client and session upload via Excel.
- **Task Management**: Creation, assignment, tracking, filtering, and commenting.
- **Hierarchical Library System**: Categorized clinical content with smart auto-connection and search.
- **Risk Assessment**: 10-factor matrix with automated scoring.
- **User Profile System**: Detailed user profiles with credentials, role management, and working hours configuration for appointment scheduling.
- **Billing Integration**: Service catalog, room management, automatic billing triggers, payment status tracking.
- **Assessment Management**: Template creation, client assignment, AI-powered report generation, draft/finalize workflow, digital signatures, PDF/Word export, HIPAA audit logging.
- **Checklist Management**: Comprehensive templates for process workflows.
- **Dashboard**: Key metrics, quick actions, recent activity, upcoming deadlines.
- **HIPAA Compliance Audit System**: Comprehensive activity tracking for PHI access, data modifications, login attempts across critical operations.
- **Email Communications History**: Audit trail of client emails (scheduling, reminders) accessible in client profiles.
- **Login Error Feedback**: Professional handling with specific backend messages, visual cues, and persistent error state.
- **Client Portal**: Secure portal access for clients to view appointments, upload documents, and manage their care with HIPAA-compliant audit logging. Portal displays all dates/times in America/New_York timezone for consistency.
- **AI Assistant**: Interactive chat assistant powered by GPT-5 (via Replit AI Integrations) to help users navigate TherapyFlow. Provides context-aware guidance for both therapists and clients, with quick suggestions based on the current page. Available as a floating chat widget throughout the application.

## External Dependencies

### Core
- **@neondatabase/serverless**: PostgreSQL connection.
- **drizzle-orm**: Type-safe ORM.
- **@tanstack/react-query**: Server state management.
- **react-hook-form**: Form handling and validation.
- **zod**: Runtime type validation.
- **tailwindcss**: Utility-first CSS framework.
- **react-quill**: Rich text editor.

### UI & Utilities
- **@radix-ui/***: Headless UI components.
- **class-variance-authority**: Type-safe CSS class variants.
- **lucide-react**: Icon library.
- **date-fns**: Date manipulation utilities.
- **date-fns-tz**: Timezone-aware date utilities.

### Development
- **typescript**: Type safety.
- **vite**: Fast development and build tooling.
- **tsx**: TypeScript execution for Node.js.
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
- **User Profile System**: Detailed user profiles with credentials and role management.
- **Billing Integration**: Service catalog, room management, automatic billing triggers, payment status tracking.
- **Assessment Management**: Template creation, client assignment, AI-powered report generation, draft/finalize workflow, digital signatures, PDF/Word export, HIPAA audit logging.
- **Checklist Management**: Comprehensive templates for process workflows.
- **Dashboard**: Key metrics, quick actions, recent activity, upcoming deadlines.
- **HIPAA Compliance Audit System**: Comprehensive activity tracking for PHI access, data modifications, login attempts across critical operations.
- **Email Communications History**: Audit trail of client emails (scheduling, reminders) accessible in client profiles.
- **Login Error Feedback**: Professional handling with specific backend messages, visual cues, and persistent error state.

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
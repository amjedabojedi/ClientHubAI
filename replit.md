# TherapyFlow

## Overview
TherapyFlow is a comprehensive therapy practice management application designed for healthcare professionals. It provides a full-stack solution for managing client information, scheduling, documentation, and administrative tasks, aiming to streamline operations for therapists. The application focuses on robust client management, advanced scheduling, and efficient data handling, supporting a modern therapy practice with features like AI-assisted note generation and comprehensive billing integration.

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
- **Design Principles**: Responsive design (mobile-first), clean visual hierarchy, professional UI components, color-coded indicators.
- **Date Formatting**: Standardized date display using date-fns `format()` - "MMM dd, yyyy" for dates (e.g., "Oct 08, 2025") and "MMM dd, yyyy HH:mm:ss" for timestamps across all user-facing components.

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js for REST API
- **Database ORM**: Drizzle ORM for type-safe operations
- **Session Management**: Express sessions with PostgreSQL storage
- **API Design**: RESTful endpoints with comprehensive CRUD operations.
- **Security**: Role-based access control (Administrator, Clinical Supervisor, Therapist, Intern/Trainee) with 15 granular permissions across 6 categories. Comprehensive data isolation based on roles and supervisor assignments.

### Database
- **Database**: PostgreSQL (configured for Neon serverless)
- **ORM**: Drizzle ORM with schema-first approach
- **Migrations**: Drizzle Kit for schema management
- **Connection**: Connection pooling with @neondatabase/serverless
- **Data Models**: Clients, Users, Sessions, Tasks, Notes, Documents, System Options, Library (hierarchical), Assessment Templates, Checklist Templates, Supervisor Assignments.
- **Scalability**: Optimized for 5000+ client records with efficient indexing, connection pooling, and query optimization.

### Key Features
- **Client Management**: Comprehensive profiles, status tracking, search/filtering, bulk operations, direct scheduling.
- **Scheduling & Calendar**: Multi-view calendar (monthly, day/week), session management, role-based access, visual indicators. In-place session editing from client profiles for client-centric workflow (with optional calendar view for full context).
- **Session Notes**: Comprehensive session note management with mood tracking, goals, interventions, clinical documentation fields, rich text editing capability (react-quill), and AI-assisted generation from templates. Full create/edit/delete functionality with authenticated user tracking.
- **System Options Management**: Dynamic, database-driven configuration for all dropdown options.
- **Bulk Data Operations**: Bulk client and session upload via Excel with field mapping, robust validation, and error reporting.
- **Task Management**: Comprehensive task creation, assignment, tracking, filtering, and commenting system.
- **Hierarchical Library System**: Categorized library of clinical content with smart auto-connection and search.
- **Risk Assessment**: Professional 10-factor risk matrix with automated scoring and clinical documentation.
- **User Profile System**: Detailed user profiles with professional credentials, role-based management, and supervisor assignments.
- **Billing Integration**: Service catalog with CPT codes, room management, automatic billing triggers from completed sessions, payment status tracking.
- **Assessment Management**: Creation of assessment templates with various question types, assignment to clients, and AI-powered report generation.
- **Checklist Management**: Comprehensive checklist templates for process workflows.
- **Dashboard**: Informative homepage with key metrics, quick actions, recent activity, and upcoming deadlines.
- **HIPAA Compliance Audit System**: Comprehensive activity tracking for healthcare privacy compliance including PHI access, data modifications, and login attempts.
- **Email Communications History**: Complete audit trail of all client emails (session scheduled, rescheduled, 24hr reminders, intake reminders) with timestamps, email content, and collapsible view. Accessible via dedicated Communications tab in client profiles.

## External Dependencies

### Core
- **@neondatabase/serverless**: PostgreSQL connection for serverless environments.
- **drizzle-orm**: Type-safe ORM.
- **@tanstack/react-query**: Server state management.
- **react-hook-form**: Form handling and validation.
- **zod**: Runtime type validation.
- **tailwindcss**: Utility-first CSS framework.
- **react-quill**: Rich text editor for formatted note content.

### UI & Utilities
- **@radix-ui/***: Headless UI components.
- **class-variance-authority**: Type-safe CSS class variants.
- **lucide-react**: Icon library.
- **date-fns**: Date manipulation utilities.

### Development
- **typescript**: Type safety.
- **vite**: Fast development and build tooling.
- **tsx**: TypeScript execution for Node.js.
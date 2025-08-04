# TherapyFlow

## Overview
TherapyFlow is a comprehensive therapy practice management application designed for healthcare professionals. It provides a full-stack solution for managing client information, scheduling, documentation, and administrative tasks, aiming to streamline operations for therapists. The application focuses on robust client management, advanced scheduling, and efficient data handling, supporting a modern therapy practice with features like AI-assisted note generation and comprehensive billing integration.

## User Preferences
Preferred communication style: Simple, everyday language.
Code organization: Keep code clean and well-organized when making changes.
Application name: TherapyFlow (to be used consistently throughout the application).

## Recent Changes (August 2025)
- **Client Reference Number Display**: Updated All Sessions view to display actual client reference numbers (like "1613015", "63904052") instead of system client IDs, providing proper client identification for record tracking.
- **Service Code System Consolidation**: Unified service code management by eliminating duplicate system_options category 32 and using only the services table for consistent service code handling across all components.
- **Session Bulk Upload Fix**: Updated session bulk upload to use the new unified services table instead of the deprecated system_options lookup, enabling successful session imports.
- **Excel Date Format Support**: Added comprehensive Excel date handling for session uploads, supporting both Excel serial dates (43772 → 2019-11-03) and MM/DD/YY format (12/23/19 → 2019-12-23).
- **Service Code Trimming**: Enhanced service code lookup to handle leading/trailing spaces in uploaded data.
- **Service Code Management**: Added full CRUD operations for service codes in Settings page with proper constraint checking for deletion when services are referenced in sessions or billing records.

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
- **Scheduling & Calendar**: Multi-view calendar (monthly, day/week), session management (create, edit, reschedule, cancel), role-based access, visual indicators.
- **Data Models**: Comprehensive data models for all core entities including clients, users, sessions, tasks, notes, and documents.
- **UI Components**: Reusable, responsive components including sortable/filterable data grids, modals, and validated forms.
- **Session Notes**: Comprehensive session note management with mood tracking, goals, interventions, assessments, and AI-assisted generation from templates.
- **System Options Management**: Dynamic, database-driven configuration for all dropdown options (e.g., Session Types, Client Stages).
- **Bulk Data Operations**: Bulk client and session upload via Excel with field mapping, robust validation, and error reporting.
- **Task Management**: Comprehensive task creation, assignment, tracking, filtering, and commenting system.
- **Hierarchical Library System**: Categorized library of clinical content (Session Focus, Symptoms, Goals, Interventions, Progress) with smart auto-connection and search.
- **Risk Assessment**: Professional 10-factor risk matrix with automated scoring and clinical documentation.
- **User Profile System**: Detailed user profiles with professional credentials, role-based management, and supervisor assignments.
- **Billing Integration**: Service catalog with CPT codes, room management, automatic billing triggers from completed sessions, payment status tracking.
- **Assessment Management**: Creation of assessment templates with various question types, and assignment to clients.
- **Checklist Management**: Comprehensive checklist templates for process workflows (intake, assessment, ongoing, discharge) with individual item tracking and notes.
- **Dashboard**: Informative homepage with key metrics, quick actions, recent activity, and upcoming deadlines.

## External Dependencies

### Core
- **@neondatabase/serverless**: PostgreSQL connection for serverless environments.
- **drizzle-orm**: Type-safe ORM.
- **@tanstack/react-query**: Server state management.
- **react-hook-form**: Form handling and validation.
- **zod**: Runtime type validation.
- **tailwindcss**: Utility-first CSS framework.

### UI & Utilities
- **@radix-ui/***: Headless UI components.
- **class-variance-authority**: Type-safe CSS class variants.
- **lucide-react**: Icon library.
- **date-fns**: Date manipulation utilities.

### Development
- **typescript**: Type safety.
- **vite**: Fast development and build tooling.
- **tsx**: TypeScript execution for Node.js.
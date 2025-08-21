# TherapyFlow

## Overview
TherapyFlow is a comprehensive therapy practice management application for healthcare professionals. It offers a full-stack solution to streamline operations by managing client information, scheduling, documentation, and administrative tasks. Key capabilities include robust client management, advanced scheduling, efficient data handling, AI-assisted note generation, and comprehensive billing integration. The project's vision is to provide a modern, efficient, and compliant solution for therapy practices.

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

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js for REST API
- **Database ORM**: Drizzle ORM for type-safe operations
- **Session Management**: Express sessions with PostgreSQL storage
- **API Design**: RESTful endpoints with comprehensive CRUD operations.
- **Security**: Role-based access control (Administrator, Clinical Supervisor, Therapist, Intern/Trainee) with 15 granular permissions across 6 categories, including data isolation.

### Database
- **Database**: PostgreSQL (configured for Neon serverless)
- **ORM**: Drizzle ORM with schema-first approach
- **Migrations**: Drizzle Kit for schema management
- **Connection**: Connection pooling with @neondatabase/serverless
- **Data Models**: Clients, Users, Sessions, Tasks, Notes, Documents, System Options, Library (hierarchical), Assessment Templates, Checklist Templates, Supervisor Assignments.
- **Scalability**: Optimized for 5000+ client records with efficient indexing, connection pooling, and query optimization.

### Key Features
- **Client Management**: Comprehensive profiles, status tracking, search/filtering, bulk operations, and direct scheduling.
- **Scheduling & Calendar**: Multi-view calendar, session management (create, edit, reschedule, cancel), role-based access, and visual indicators.
- **Session Notes**: Comprehensive session note management with mood tracking, goals, interventions, assessments, and AI-assisted generation.
- **System Options Management**: Dynamic, database-driven configuration for all dropdown options.
- **Bulk Data Operations**: Bulk client and session upload via Excel with field mapping and validation.
- **Task Management**: Comprehensive task creation, assignment, tracking, filtering, and commenting system.
- **Hierarchical Library System**: Categorized library of clinical content (Session Focus, Symptoms, Goals, Interventions, Progress) with auto-connection and search.
- **Risk Assessment**: Professional 10-factor risk matrix with automated scoring and clinical documentation.
- **User Profile System**: Detailed user profiles with professional credentials, role-based management, and supervisor assignments.
- **Billing Integration**: Service catalog with CPT codes, room management, automatic billing triggers, and payment status tracking.
- **Assessment Management**: Creation of assessment templates with various question types, assignment to clients, and auto-save functionality for responses. AI-powered report generation with intelligent section mapping and multi-format output.
- **Checklist Management**: Comprehensive checklist templates for process workflows (intake, assessment, ongoing, discharge).
- **Dashboard**: Informative homepage with key metrics, quick actions, recent activity, and upcoming deadlines.
- **HIPAA Compliance Audit System**: Comprehensive audit logging system tracking PHI access, data modifications, login attempts, and user activities with risk level classification, and an audit dashboard.

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
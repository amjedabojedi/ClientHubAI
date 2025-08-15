# TherapyFlow

## Overview
TherapyFlow is a comprehensive therapy practice management application designed for healthcare professionals. It provides a full-stack solution for managing client information, scheduling, documentation, and administrative tasks, aiming to streamline operations for therapists. The application focuses on robust client management, advanced scheduling, and efficient data handling, supporting a modern therapy practice with features like AI-assisted note generation and comprehensive billing integration.

## User Preferences
Preferred communication style: Simple, everyday language.
Code organization: Keep code clean and well-organized when making changes.
Application name: TherapyFlow (to be used consistently throughout the application).

## Recent Changes (August 2025)
- **Start Date Functionality**: Implemented comprehensive start date feature showing actual first session dates instead of administrative start dates across client grid, profile, and edit form. Provides meaningful therapy start tracking for clinical record-keeping.
- **Client Type System Integration**: Fixed inconsistency between hard-coded client type options in edit form and dynamic system options in settings. Edit form now uses database-driven options ensuring consistency across the application.
- **Client Reference Number Display**: Updated All Sessions view to display actual client reference numbers (like "1613015", "63904052") instead of system client IDs, providing proper client identification for record tracking.
- **Bulk Session Status Update**: Added "Mark All Scheduled as Completed" button in All Sessions view to bulk update all scheduled sessions to completed status with improved batch processing and error handling to prevent server overload.
- **Settings Page Cache Fix**: Fixed issue where system options would disappear after updates by implementing sequential cache invalidation to ensure the UI refreshes correctly.
- **Service Code System Consolidation**: Unified service code management by eliminating duplicate system_options category 32 and using only the services table for consistent service code handling across all components.
- **Session Bulk Upload Fix**: Updated session bulk upload to use the new unified services table instead of the deprecated system_options lookup, enabling successful session imports.
- **Excel Date Format Support**: Added comprehensive Excel date handling for session uploads, supporting both Excel serial dates (43772 → 2019-11-03) and MM/DD/YY format (12/23/19 → 2019-12-23).
- **Service Code Trimming**: Enhanced service code lookup to handle leading/trailing spaces in uploaded data.
- **Service Code Management**: Added full CRUD operations for service codes in Settings page with proper constraint checking for deletion when services are referenced in sessions or billing records.
- **Code Quality Improvement**: Comprehensive code cleanup reducing TypeScript errors from 30 to 0, removed console.log statements, improved type safety with proper interfaces, and organized code structure for better maintainability.
- **Clients with No Sessions Filter**: Added comprehensive filtering capability for clients without sessions, available in both dedicated client navigation tab and advanced search filters with proper backend query optimization and client statistics integration.
- **User Profile Save Error Fix**: Resolved critical user profile save error by correcting user ID lookup from non-existent ID 1 to valid admin user ID 6, fixed TypeScript errors in profile form, and implemented proper useEffect dependency tracking to prevent infinite loops and maximum update depth errors.
- **Sessions List Performance Optimization**: Implemented comprehensive filtering and pagination for sessions list to prevent system overload. Added default current month filter, pagination (25-50-100 per page), date range filters, therapist/status/service code filters, and smart server-side processing. Prevents loading all 3,818+ sessions at once, improving performance and user experience significantly.
- **Assessment Template Date and Number Fields**: Enhanced assessment template system with comprehensive date and number question types. Added database enum values for 'date' and 'number' question types, updated frontend template builder with date picker and number input fields, and fixed 500 error during question updates. Assessment templates now support full range of data collection including dates (birth dates, incident dates) and numeric values (age, scores, measurements).
- **Assessment Section Management**: Added collapse/expand functionality and section reordering controls to assessment template builder. Sections can be collapsed to show just title and question count for better organization. Up/down arrow buttons allow easy reordering of sections with proper state management for collapsed sections. Provides streamlined workflow for managing complex assessment templates with multiple sections.
- **Client Assessment Template Display**: Enhanced client assessment tab with visual template cards showing "Assign to Client" buttons for each available assessment template. Replaced dropdown-only assignment interface with user-friendly card layout displaying template name, description, category, and version. Makes assessment assignment more intuitive and accessible directly from the client profile page.
- **Assessment Progress Auto-Save**: Implemented comprehensive auto-save functionality for assessment responses. Includes automatic saving every 30 seconds, save-on-blur for individual questions, before-unload protection to prevent data loss, and manual "Save Progress" button. Users can now safely stop and continue assessments later without losing their work.
- **Missing Question Types Fix**: Added support for `number` and `date` question types in assessment completion interface. Previously only supported text, multiple choice, rating scale, and checkbox questions. Now handles all question types defined in the database with appropriate input fields and validation.
- **HIPAA Compliance Audit System**: Implemented comprehensive HIPAA audit logging system with complete activity tracking for healthcare privacy compliance. Created database tables (audit_logs, login_attempts, user_sessions) with proper indexing. Built audit logger service for tracking PHI access, data modifications, login attempts, and user activities with risk level classification. Added audit middleware for automatic logging of API requests. Created professional HIPAA audit dashboard with filtering, statistics, and export capabilities for compliance reporting. All client data access now automatically logged with timestamps, IP addresses, user agents, and risk assessment.
- **Enhanced AI Report Generation System**: Implemented comprehensive AI-powered assessment report generation with intelligent section mapping, professional clinical formatting, and multi-format output capabilities. Features include client basic information headers, section-specific AI prompts (background/history, symptoms/presentation, mental status), automatic Clinical Summary and Intervention Plan sections, regenerate functionality, print preview (report-only), PDF/Word downloads with proper formatting, and Chrome browser installation for reliable PDF generation. Reports follow clinical documentation standards with third-person narrative and evidence-based recommendations.
- **Flexible General Report Sections**: Moved from hard-coded to database-driven general sections. Users can now configure custom AI report sections (Clinical Summary, Risk Assessment, Intervention Plan, etc.) through the Template Builder. Access via Assessments → Edit Template → Build button → expand sections to find "Report Section Type" and "AI Report Instructions" fields. System supports unlimited custom general sections with personalized AI prompts.

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
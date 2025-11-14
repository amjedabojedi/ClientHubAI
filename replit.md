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

### PDF Generation
A dual strategy using browser print dialogs for user downloads and server-side Puppeteer for automated PDF generation (e.g., email attachments).

### AI Integration
OpenAI GPT-4o is integrated for clinical content generation, including AI-assisted session notes and assessment report interpretation, with a human review workflow.

## Data Model Design

### Client Lifecycle Management
Comprehensive client management includes tracking through various stages and statuses, detailed profiles, onboarding, portal access, and multi-level duplicate detection. Features bulk client management with role-based access for stage changes, therapist reassignment, portal access toggling, and status updates, all with audit logging and detailed reporting.

### Clinical Documentation

**Session Management:** Tracks sessions linking clients, therapists, services, and rooms, with auto-billing.
**Session Notes:** Stores AI-generated drafts and progress notes.
**Assessments:** Manages assessment templates, assignments, responses, and AI-generated reports. Assessment responses use option IDs (not array indices) for proper scoring and AI report generation. Backend normalization layer handles legacy index-based data during transition.

**Clinical Content Library:** A comprehensive system for reusable clinical content. It uses a structured title pattern (`[CONDITION][TYPE][NUMBER]_[VARIANT]`) for categorization. A "Smart Connect" feature auto-suggests connections between entries based on patterns and keywords, defining relationship types. The system supports bulk import from Excel with validation, natural sorting, and prevents duplicate entries.

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
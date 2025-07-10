# Client Management System

## Overview

This is a comprehensive Client Management System (CMS) designed for healthcare professionals, specifically therapists. The application provides a full-stack solution for managing client information, scheduling, documentation, and administrative tasks. It's built as a modern web application with a React frontend and Express.js backend, using PostgreSQL for data persistence.

## User Preferences

Preferred communication style: Simple, everyday language.
Code organization: Keep code clean and well-organized when making changes.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for client-side navigation
- **State Management**: TanStack Query (React Query) for server state management
- **UI Framework**: Radix UI components with custom styling
- **Styling**: Tailwind CSS with CSS variables for theming
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite for development and bundling

### Backend Architecture
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js for REST API
- **Database ORM**: Drizzle ORM for type-safe database operations
- **Session Management**: Express sessions with PostgreSQL storage
- **API Design**: RESTful endpoints with comprehensive CRUD operations

### Database Architecture
- **Database**: PostgreSQL (configured for Neon serverless)
- **ORM**: Drizzle ORM with schema-first approach
- **Migrations**: Drizzle Kit for database schema management
- **Connection**: Connection pooling with @neondatabase/serverless

## Key Components

### Client Management Module
The core feature providing comprehensive client lifecycle management:
- **Client Profiles**: Complete demographic and contact information
- **Status Tracking**: Active, inactive, and pending client states
- **Stage Management**: Intake, assessment, and psychotherapy phases
- **Search & Filtering**: Advanced filtering by multiple criteria
- **Bulk Operations**: Mass actions on multiple client records
- **Direct Scheduling**: Schedule button on each client for immediate appointment creation

### Scheduling & Calendar System
Advanced appointment management with multi-view calendar system:
- **Monthly Calendar View**: Full calendar grid with session indicators and click-to-edit
- **Day/Week Views**: Detailed timeline views with session blocks
- **Client Integration**: Direct links between sessions and client profiles
- **Search & Filtering**: Find sessions by client name or therapist
- **Session Management**: Create, edit, reschedule, and cancel appointments
- **Role-Based Access**: Therapist-specific views and admin oversight
- **Quick Actions**: Schedule additional sessions, view client profiles
- **Visual Indicators**: Color-coded session types and status badges
- **Avatar Integration**: Client initials and profile pictures in session cards

### Data Models
- **Clients**: Full client profiles with demographics, contact info, and clinical data
- **Users**: Therapist and staff accounts with role-based permissions
- **Sessions**: Appointment and session tracking
- **Tasks**: Task management with priorities and status tracking
- **Notes**: Clinical notes and documentation
- **Documents**: File attachments and document management

### UI Components
- **Responsive Design**: Mobile-first approach with desktop optimization
- **Component Library**: Comprehensive set of reusable UI components
- **Data Grid**: Sortable, filterable table with pagination
- **Modal System**: Detailed client information overlays
- **Form Controls**: Validated forms with real-time feedback

## Data Flow

### Client Data Retrieval
1. Frontend requests client data via TanStack Query
2. Express API handles request with filtering/pagination parameters
3. Drizzle ORM constructs optimized PostgreSQL queries
4. Results are returned with metadata (total count, pagination info)
5. Frontend updates UI with loading states and error handling

### Client Operations
1. User interactions trigger form submissions or bulk actions
2. Frontend validates data using Zod schemas
3. API endpoints process requests with proper error handling
4. Database operations are executed within transactions
5. Success/error feedback is provided to the user

### Real-time Updates
- Optimistic updates for immediate user feedback
- Query invalidation for data consistency
- Debounced search to reduce API calls
- Pagination and sorting maintained across operations

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL connection for serverless environments
- **drizzle-orm**: Type-safe ORM for database operations
- **@tanstack/react-query**: Server state management
- **react-hook-form**: Form handling and validation
- **zod**: Runtime type validation
- **tailwindcss**: Utility-first CSS framework

### UI Dependencies
- **@radix-ui/***: Headless UI components for accessibility
- **class-variance-authority**: Type-safe CSS class variants
- **lucide-react**: Icon library
- **date-fns**: Date manipulation utilities

### Development Dependencies
- **typescript**: Type safety across the stack
- **vite**: Fast development and build tooling
- **tsx**: TypeScript execution for Node.js

## Deployment Strategy

### Development Environment
- **Dev Server**: Vite development server with HMR
- **API Server**: Express server with file watching
- **Database**: Local PostgreSQL or Neon development database
- **Environment Variables**: Database URL and configuration

### Production Build
- **Frontend**: Vite builds optimized static assets
- **Backend**: ESBuild bundles server code for Node.js
- **Static Serving**: Express serves built frontend assets
- **Database**: PostgreSQL with connection pooling

### Environment Configuration
- **DATABASE_URL**: PostgreSQL connection string
- **NODE_ENV**: Environment-specific configuration
- **Session Management**: Secure session configuration for production

### Scalability Considerations
- **Database Indexing**: Optimized for 5000+ client records
- **Connection Pooling**: Efficient database connection management
- **Query Optimization**: Drizzle ORM generates efficient SQL
- **Frontend Performance**: Code splitting and lazy loading ready

## Recent Changes

### AI Session Note Features Implementation (January 2025)
- **AI Integration**: Implemented comprehensive OpenAI-powered session note features with GPT-4o model
- **Connected Template Library**: Built intelligent clinical content library with therapy-specific approaches (CBT, Trauma-Focused, Mindfulness-Based)
- **Smart Field Connections**: Automatic field population based on clinical relationships (e.g., selecting "anxiety management" auto-fills related symptoms, interventions, progress)
- **Clinical Content Options**: Each field provides multiple professional options specific to the selected therapy approach
- **Therapy-Specific Language**: Templates ensure evidence-based clinical terminology matching therapeutic modalities
- **One-Click Professional Content**: Select from pre-written clinical options that maintain consistency across documentation
- **Auto-Population System**: Connected fields automatically suggest and populate related clinical content
- **Professional Clinical Reports**: AI generates flowing prose suitable for formal medical records and documentation
- **Template-Based Workflow**: Therapists select therapy approach, then choose from curated clinical content options for each field
- **Intelligent Suggestions**: System recognizes field relationships and suggests appropriate connected content automatically

### Session Notes Feature Implementation (January 2025)
- **Database Schema**: Added comprehensive session notes table with detailed tracking fields and AI management columns
- **Backend API**: Implemented full CRUD operations for session notes management with integrated AI processing
- **Session Notes Manager**: Built comprehensive component with advanced features including mood tracking, goals, interventions, assessments, and privacy controls
- **Workflow Integration**: Added "Add Notes" buttons to completed sessions in Sessions tab for direct access
- **User Workflow**: Session notes accessible through existing booked sessions, with Session Notes tab showing all existing notes for viewing and editing

### Code Organization Improvements (January 2025)
- **Import Structure**: Organized imports by category (UI Components, Icons, Utils)
- **Function Organization**: Grouped related functions with clear section comments
- **Type Safety**: Added explicit return types to utility functions
- **Code Clarity**: Improved variable declarations and function structure
- **Comment Structure**: Added clear section dividers for better navigation
- **Interface Documentation**: Enhanced storage interface with descriptive section comments

### Performance Optimization (January 2025)
- **Icon System Optimization**: Replaced heavy FontAwesome icons with lightweight Lucide React icons
- **Tree-shaking Benefits**: All icons now use tree-shakeable imports for reduced bundle size
- **Centralized Icon Management**: Created icon utility system for consistent performance
- **Bundle Size Reduction**: Eliminated FontAwesome dependency reducing potential timeouts
- **Consistent Icon Sizing**: Standardized icon sizes across application for better performance
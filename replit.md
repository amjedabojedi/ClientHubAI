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

### Two-Step AI Session Note Generation (January 2025)
- **Two-Step Workflow**: Implemented separate template creation and content generation phases for optimal AI assistance
- **Template Creation**: Users save custom instructions that guide AI generation process for consistent, personalized output
- **Content Generation**: AI generates session notes after clinical fields are filled, using saved template instructions
- **Dual Button Interface**: "Create Template" button for saving instructions, "Generate Content" button for actual AI generation
- **State Management**: UI dynamically shows template status (create vs edit) and enables content generation only after template is saved
- **Field-Based Generation**: AI processes filled clinical fields combined with saved template instructions for contextual content
- **Professional Workflow**: Separates planning phase (template creation) from documentation phase (content generation)
- **Custom Instructions**: Users provide detailed therapy approach, formatting preferences, and clinical focus areas
- **Real-Time Processing**: AI processes user instructions along with client and session data for contextual content generation
- **Error Handling**: Comprehensive validation ensuring template exists before content generation
- **Integration Ready**: Works seamlessly with existing Library system for content insertion into AI-generated templates

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

### Hierarchical Library System Implementation (January 2025)
- **Database Schema**: Added comprehensive library tables with categories and entries supporting hierarchical structure
- **Backend API**: Implemented full CRUD operations for library categories and entries with search functionality
- **Frontend Component**: Built complete library page with category tree navigation and entry management
- **Navigation Integration**: Added library page to main application navigation
- **Sample Data**: Seeded 5 main categories (Session Focus, Symptoms, Short-term Goals, Interventions, Progress) with sample clinical content
- **Connected Entries**: Implemented intelligent connection system that identifies related entries through shared tags
- **Smart Navigation**: Added click-to-scroll functionality for navigating between connected library entries

### Auto-Connection System Enhancement (January 2025)
- **Smart Entry Creation**: Entry forms now auto-detect related entries from different categories based on shared keywords and tags
- **Cross-Category Focus**: Auto-suggestions only show entries from different categories, encouraging meaningful cross-category connections
- **Real-time Suggestions**: As users type titles or tags, system shows related entries with checkboxes for instant connection
- **Automatic Database Connections**: Selected suggestions automatically create database relationships when entry is created
- **Connection Intelligence**: System uses keyword matching to identify related clinical content across categories
- **User-Friendly Interface**: Green suggestion boxes show exactly how connections will help in session notes workflow

### Category Filter Consistency Fix (January 2025)
- **Consistent Filter Display**: Fixed category filter to show ALL 5 main categories regardless of entry count
- **Predictable Behavior**: Filter now works identically from any starting category tab
- **User Experience**: Eliminated confusion where different tabs showed different available categories
- **Complete Coverage**: All main therapeutic categories (Session Focus, Symptoms, Short-term Goals, Interventions, Progress) always visible in connection dialog

### Library-Session Notes Integration (January 2025)
- **Direct Field Integration**: Added Library picker buttons (📚) to all clinical documentation fields in session notes
- **Category-Specific Content**: Each field shows only relevant library entries (Session Focus → Category 1, Symptoms → Category 2, etc.)
- **Seamless Content Insertion**: Click library entries to auto-populate session note fields with professional clinical content
- **Smart Content Combination**: New content appends to existing text instead of overwriting for flexible documentation
- **Usage Analytics**: Automatic tracking of which library entries are most frequently used in session documentation
- **Search Integration**: Built-in search within library picker for quick content discovery
- **Professional Workflow**: Enables rapid session documentation using pre-written, clinically-appropriate content templates
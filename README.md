# SmartHub - Therapy Practice Management System

A comprehensive therapy practice management application for mental health professionals.

## Features

- **Client Management**: Complete client lifecycle tracking with portal access
- **Clinical Forms System**: Electronic signatures, consent forms, intake forms with auto-fill
- **Assessment System**: Clinical assessments with AI-powered report generation
- **Session Management**: Session notes, scheduling, and billing integration
- **Clinical Content Library**: Reusable clinical content with smart connections
- **Billing & Payments**: Stripe integration for automated billing
- **HIPAA Compliance**: Audit logging and secure document storage

## Technology Stack

- **Frontend**: React 18+ with TypeScript, Vite, TanStack Query, Shadcn/ui
- **Backend**: Node.js with Express, Drizzle ORM, PostgreSQL
- **AI**: OpenAI GPT-4o for clinical content generation
- **Storage**: Azure Blob Storage for documents
- **Deployment**: Replit infrastructure

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Push database schema changes
npm run db:push
```

## Environment Variables

Required environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` or `AI_INTEGRATIONS_OPENAI_API_KEY` - For AI features
- `AZURE_STORAGE_CONNECTION_STRING` - For document storage
- `STRIPE_SECRET_KEY` - For payment processing

## Assessment Score Recalculation

For existing assessments with incorrect scores, use the recalculate script:

```bash
tsx recalculate-scores.ts <assignmentId>
```

## Latest Updates (2025-01-13)

- Fixed assessment scoring to use option IDs instead of array indices
- Fixed AI report generation to include complete client responses
- Improved assessment report quality and completeness

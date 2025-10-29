/**
 * Custom TherapyFlow Navigation Assistant
 * Hybrid approach: Database-backed guides with rule-based matching
 */

import { storage } from './storage';
import type { HelpGuide } from '@shared/schema';

interface NavigationGuide {
  question: string[];
  answer: string;
  category: string;
  helpGuideSlug?: string;
}

// Knowledge base of actual TherapyFlow navigation - built from real app structure
const NAVIGATION_GUIDES: NavigationGuide[] = [
  // Client Management
  {
    question: ["add client", "new client", "create client"],
    answer: "👤 ADD A NEW CLIENT\n\nGo to: Clients → + Add Client\n\nRequired:\n  • First Name\n  • Last Name\n\nOptional:\n  • Email (enables portal access and reminders)\n  • Phone, Date of Birth\n  • Address\n  • Status: Active, Inactive, Discharged\n  • Risk Level: None, Low, Medium, High, Critical\n  • Assigned Therapist\n\nTips:\n  • Email required for client portal\n  • Risk level triggers monitoring alerts\n  • Assigned therapist links to scheduling",
    category: "clients",
    helpGuideSlug: "add-client"
  },
  {
    question: ["view client", "see client", "find client", "client profile"],
    answer: "📁 VIEW CLIENT PROFILE\n\nGo to: Clients → Search or browse → Click client name\n\nProfile tabs (10 total):\n  • Overview - Basic info, demographics\n  • Sessions - Session notes and history\n  • Assessments - Assigned assessments and reports\n  • Documents - Uploaded files and forms\n  • Billing - Payment history and invoices\n  • Tasks - Client-related tasks\n  • Checklist - Process checklists\n  • Communications - Email history\n  • History - Audit trail of changes\n  • Portal Access - Login credentials\n\nQuick actions:\n  • Schedule appointment\n  • Add session note\n  • Upload documents",
    category: "clients",
    helpGuideSlug: "add-client"
  },
  {
    question: ["edit client", "update client", "change client"],
    answer: "✏️ EDIT CLIENT INFO\n\nSteps:\n  1. Clients → Click client name\n  2. Click Edit button\n  3. Update information\n  4. Save\n\nEditable fields:\n  • Demographics (name, DOB, contact)\n  • Status: Active, Inactive, Discharged\n  • Risk Level: None, Low, Medium, High, Critical\n  • Assigned Therapist\n  • Address details\n\nImportant:\n  • All changes logged in HIPAA audit\n  • Status changes affect list visibility\n  • Risk level changes trigger alerts",
    category: "clients",
    helpGuideSlug: "edit-client"
  },
  
  // Scheduling
  {
    question: ["schedule appointment", "book session", "add appointment", "create session"],
    answer: "📅 SCHEDULE APPOINTMENT\n\nGo to: Scheduling → Choose view (Day/Week/Month) → Click time slot\n\nRequired fields:\n  • Client\n  • Session Type: Initial, Follow-up, Group, etc.\n  • Service (from billing catalog)\n  • Start Time & Duration\n  • Location/Room\n\nSession statuses:\n  • Scheduled (default)\n  • Completed\n  • Cancelled\n  • Rescheduled\n  • No Show\n\nFeatures:\n  • Color-coded by session type\n  • Drag to reschedule\n  • Double-click for quick add\n  • Service auto-sets billing",
    category: "scheduling",
    helpGuideSlug: "schedule-appointment"
  },
  {
    question: ["calendar view", "change view", "switch view"],
    answer: "🗓️ CALENDAR VIEWS\n\nViews available:\n  • Day - Hourly breakdown, detailed\n  • Week - 7-day overview, planning\n  • Month - Full month snapshot\n\nHow to switch:\n  • Click tabs at top\n  • Use arrow buttons to navigate\n  • Click Today to jump to current date\n\nFeatures:\n  • Color-coded sessions\n  • Click to edit in-place\n  • Filter by therapist or room",
    category: "scheduling",
    helpGuideSlug: "schedule-appointment"
  },
  {
    question: ["cancel appointment", "delete session", "cancel session"],
    answer: "❌ CANCEL/RESCHEDULE\n\nTo cancel:\n  1. Click appointment on calendar\n  2. Edit → Change status to Cancelled\n  3. Add reason (optional)\n  4. Save\n\nTo reschedule:\n  • Drag session to new time, OR\n  • Edit → Change date/time → Save\n\nImportant:\n  • Cancelled sessions kept for records\n  • Billing updates automatically\n  • Email notifications sent if enabled",
    category: "scheduling",
    helpGuideSlug: "schedule-appointment"
  },
  
  // Session Notes
  {
    question: ["add session note", "write note", "document session", "create note", "session note", "write session note", "create session note"],
    answer: "📝 ADD SESSION NOTE\n\nGo to: Clients → Click client → Sessions tab → + Add Session Note\n\nNote sections:\n  • Session Details (date, time, duration, type)\n  • Mood Tracking\n  • Goals & Progress\n  • Interventions Used\n  • Clinical Observations\n  • Risk Assessment (10 factors)\n  • Treatment Plan Updates\n\nRisk factors tracked:\n  Suicidal Ideation • Self-Harm • Homicidal Ideation • Psychosis • Substance Use • Impulsivity • Aggression/Violence • Trauma Symptoms • Non-Adherence • Support System\n\nFeatures:\n  • Auto-save every 30 seconds\n  • Pick from Library for quick entry\n  • Rich text formatting\n  • HIPAA audit logging",
    category: "notes",
    helpGuideSlug: "add-session-note"
  },
  {
    question: ["ai note", "generate note", "ai help note"],
    answer: "🤖 AI SESSION NOTES\n\nHow to use:\n  1. Open session note form\n  2. Click Generate with AI\n  3. AI drafts note (OpenAI)\n  4. Review and edit\n  5. Save\n\nAI generates:\n  • Clinical observations\n  • Progress notes (professional format)\n  • Treatment recommendations\n  • SOAP notes\n\nAI Templates:\n  • Create reusable templates\n  • Save for future use\n  • Fully editable output",
    category: "notes",
    helpGuideSlug: "ai-note"
  },
  
  // Library
  {
    question: ["library", "add library", "library content", "clinical content"],
    answer: "📚 ADD LIBRARY CONTENT\n\nGo to: Administration → Library\n\nCategories:\n  • Session Focus\n  • Symptoms\n  • Goals\n  • Interventions\n  • Progress\n\nSteps:\n  1. Choose category tab\n  2. Click + Add Entry\n  3. Enter content\n  4. Save",
    category: "library"
  },
  {
    question: ["connect library", "link library", "library connections"],
    answer: "🔗 CONNECT LIBRARY ENTRIES\n\nSteps:\n  1. Administration → Library\n  2. Click any entry\n  3. Click Connect button\n  4. Select related entries\n  5. Save Connections\n\nPurpose:\n  Link related content across categories for quick access in session notes",
    category: "library"
  },
  
  // Tasks
  {
    question: ["create task", "add task", "new task"],
    answer: "📋 CREATE A TASK\n\nGo to: Tasks → + Add Task\n\nRequired fields:\n  • Title and Description\n  • Client (must select)\n  • Assigned To\n  • Due Date\n  • Priority: Low, Medium, High, or Urgent\n  • Status: Pending, In Progress, Completed, or Overdue\n\nKey features:\n  • Tasks auto-mark overdue when past due date\n  • Link to clients to see in their profiles\n  • Add comments to track progress\n  • Filter by status, priority, or assignee",
    category: "tasks",
    helpGuideSlug: "create-task"
  },
  {
    question: ["filter tasks", "search tasks", "find tasks"],
    answer: "🔍 FILTER TASKS\n\nUse filters at top of Tasks page:\n  • Status: All, Pending, In Progress, Completed, Overdue\n  • Priority: All, Low, Medium, High, Urgent\n  • Assigned To: Filter by team member\n  • Client: See tasks for specific client\n\nTips:\n  • Combine multiple filters\n  • Overdue tasks highlighted in red\n  • Results update instantly",
    category: "tasks",
    helpGuideSlug: "create-task"
  },
  {
    question: ["complete task", "mark task done", "finish task"],
    answer: "✅ COMPLETE A TASK\n\nSteps:\n  1. Go to Tasks page\n  2. Click the task\n  3. Change Status to Completed\n  4. Save\n\nBest practice:\n  • Add final comment with completion notes\n  • Completed tasks stay in system for records\n  • Use filters to hide completed tasks",
    category: "tasks",
    helpGuideSlug: "create-task"
  },
  
  // Billing
  {
    question: ["add service", "billing service", "create service"],
    answer: "💵 ADD BILLING SERVICE\n\nGo to: Billing → Services tab → + Add Service\n\nService fields:\n  • Name (e.g., Individual Therapy)\n  • CPT Code (e.g., 90834)\n  • Price (default rate)\n  • Duration (minutes)\n\nTips:\n  • Services auto-populate when scheduling\n  • Link to insurance codes for claims\n  • Appear in billing reports",
    category: "billing",
    helpGuideSlug: "create-invoice"
  },
  {
    question: ["add room", "create room", "billing room"],
    answer: "🏢 ADD ROOM\n\nGo to: Billing → Rooms tab → + Add Room\n\nPurpose:\n  • Track which room for each session\n  • Filter calendar by room\n  • Include in billing records\n  • Multi-location tracking",
    category: "billing",
    helpGuideSlug: "create-invoice"
  },
  {
    question: ["payment status", "track payments", "billing sessions"],
    answer: "💳 TRACK PAYMENTS\n\nGo to: Billing → Sessions tab\n\nPayment statuses:\n  • Paid - Payment received\n  • Billed - Invoice sent, awaiting payment\n  • Pending - Completed, not yet billed\n  • Denied - Insurance claim denied\n  • Refunded - Payment refunded\n  • Follow Up - Requires attention\n\nFeatures:\n  • Filter by date and status\n  • Export for accounting\n  • Stripe integration\n  • Auto-updates when paid",
    category: "billing",
    helpGuideSlug: "create-invoice"
  },
  
  // Assessments
  {
    question: ["create assessment", "assessment template", "add assessment"],
    answer: "📋 CREATE ASSESSMENT TEMPLATE\n\nGo to: Administration → Assessments → + Create Template\n\nTemplate fields:\n  • Template Name & Description\n  • Question Type: Text, Multiple Choice, Rating Scale\n  • Question text and options\n\nFeatures:\n  • Reusable for all clients\n  • Multiple question types\n  • Edit anytime\n  • Track completion rates",
    category: "assessments"
  },
  {
    question: ["assign assessment", "give assessment to client"],
    answer: "✍️ ASSIGN ASSESSMENT\n\nGo to: Clients → Click client → Assessments tab → Assign Assessment\n\nSteps:\n  1. Select template\n  2. Set due date\n  3. Assign\n\nWorkflow statuses:\n  1. Pending - Waiting for client\n  2. Client In Progress - Started, not finished\n  3. Waiting for Therapist - Submitted, needs review\n  4. Therapist Completed - AI report in draft\n  5. Completed - Finalized with signature\n\nFeatures:\n  • Client completes via portal\n  • AI generates reports\n  • Auto-save every 30 seconds\n  • Export to PDF or Word\n  • Digital signatures",
    category: "assessments"
  },
  
  // Client Portal
  {
    question: ["client portal", "give client access", "portal access"],
    answer: "🔐 ENABLE CLIENT PORTAL\n\nGo to: Clients → Click client → Portal Access tab\n\nSteps:\n  1. Toggle Enable Portal Access ON\n  2. System auto-generates username/password\n  3. Click Send Welcome Email\n\nWhat clients can do:\n  • View appointments and schedule\n  • Upload documents securely\n  • View and pay invoices (Stripe)\n  • Complete assessments\n  • Update contact info\n\nSecurity:\n  • Unique credentials per client\n  • HIPAA audit logged\n  • See only their own data",
    category: "portal"
  },
  
  // User Management
  {
    question: ["add user", "create user", "new staff"],
    answer: "👥 ADD STAFF USER\n\nGo to: Administration → User Profiles → + Add User\n\nSteps:\n  1. Fill in user information\n  2. Select role and permissions\n  3. Create User\n\nUser roles:\n  • Admin - Full system access\n  • Supervisor - Manage team, all clients\n  • Therapist - Own clients and sessions\n  • Billing - Billing and payments only\n\nPermissions:\n  15 granular permissions per role",
    category: "admin"
  },
  {
    question: ["my profile", "change password", "update my info"],
    answer: "⚙️ MANAGE YOUR PROFILE\n\nGo to: Click your name (top right) → My Profile\n\nProfile tabs:\n  • Personal Info - Name, email, phone\n  • Credentials - 9 license types (LCSW, LMFT, PhD, etc.)\n  • Professional Details - Bio, specialties, education\n  • Working Hours - Set availability for scheduling\n  • Zoom Integration - Virtual sessions\n  • Security - Change password\n  • Notifications - Email preferences\n  • Signature - Upload digital signature\n\nTips:\n  • Working hours control availability\n  • Credentials show on reports\n  • Signature auto-applies",
    category: "profile"
  },
  
  // Navigation & General
  {
    question: ["dashboard", "home", "main page"],
    answer: "🏠 DASHBOARD\n\nAccess: Click Dashboard in top navigation\n\nQuick stats:\n  • Total Active Clients\n  • Appointments Today\n  • Pending Tasks\n  • Outstanding Payments\n\nSections:\n  • Upcoming Appointments (next 5)\n  • Recent Activity\n  • Task Alerts (overdue, urgent)\n  • Quick Actions (add client, schedule, task)",
    category: "navigation"
  },
  {
    question: ["administration", "admin menu", "settings"],
    answer: "🔧 ADMINISTRATION\n\nAccess: Click Administration in top navigation\n\nModules:\n  • Library - Clinical content\n  • Assessments - Templates\n  • Process Checklists - Workflows\n  • User Profiles - Staff management\n  • Role Management - Permissions\n  • Notifications - Email config\n  • HIPAA Audit - Security logs\n  • Settings - System config\n\nNote: Only visible to Admin and Supervisor roles",
    category: "navigation"
  },
];

/**
 * Search database guides and score them based on relevance
 */
async function searchDatabaseGuides(userQuestion: string): Promise<{ guide: HelpGuide; score: number; matchLength: number }[]> {
  try {
    // Search database guides
    const dbGuides = await storage.searchHelpGuides(userQuestion);
    
    if (dbGuides.length === 0) {
      return [];
    }
    
    const normalizedQuestion = userQuestion.toLowerCase().trim().replace(/[?!.,]/g, '');
    const fillerWords = ['how', 'do', 'i', 'can', 'where', 'what', 'is', 'the', 'a', 'an', 'to', 'for', 'my', 'me', 'you', 'your'];
    const questionTokens = normalizedQuestion
      .split(/\s+/)
      .filter(word => word.length > 1 && !fillerWords.includes(word));
    
    // Score each guide based on keyword overlap
    const scoredGuides = dbGuides.map(guide => {
      let bestScore = 0;
      let bestMatchLength = 0;
      
      // Combine title, tags, and search terms for matching
      const allKeywords = [
        guide.title.toLowerCase(),
        ...guide.tags.map(t => t.toLowerCase()),
        ...guide.searchTerms.map(t => t.toLowerCase())
      ];
      
      // Try each keyword pattern
      for (const keyword of allKeywords) {
        const keywordTokens = keyword.split(/\s+/).filter(t => t.length > 1);
        
        const matchedKeywords = keywordTokens.filter(kt => 
          questionTokens.some(qt => qt === kt)
        ).length;
        
        const matchedQuestion = questionTokens.filter(qt =>
          keywordTokens.some(kt => qt === kt)
        ).length;
        
        const completeness = keywordTokens.length > 0 ? matchedKeywords / keywordTokens.length : 0;
        const coverage = questionTokens.length > 0 ? matchedQuestion / questionTokens.length : 0;
        const specificity = keywordTokens.length;
        
        const score = (completeness * 0.5) + (coverage * 0.4) + (Math.min(specificity / 5, 1) * 0.1);
        
        if (score > bestScore || (score === bestScore && specificity > bestMatchLength)) {
          bestScore = score;
          bestMatchLength = specificity;
        }
      }
      
      return { guide, score: bestScore, matchLength: bestMatchLength };
    }).filter(item => item.score > 0.3);
    
    // Sort by score, then by view count (popularity)
    scoredGuides.sort((a, b) => {
      if (Math.abs(b.score - a.score) < 0.01) {
        return (b.guide.viewCount || 0) - (a.guide.viewCount || 0);
      }
      return b.score - a.score;
    });
    
    return scoredGuides;
  } catch (error) {
    console.error('Error searching database guides:', error);
    return [];
  }
}

/**
 * Format guide response - database guides already comprehensive, no link needed
 */
function formatGuideResponse(guide: HelpGuide): string {
  return guide.content;
}

/**
 * Find the best matching answer for a user's question
 * Searches database first, falls back to local guides if needed
 */
export async function findAnswer(userQuestion: string): Promise<string> {
  // Try database guides first
  const dbResults = await searchDatabaseGuides(userQuestion);
  if (dbResults.length > 0) {
    return formatGuideResponse(dbResults[0].guide);
  }
  
  // Fallback to local guides
  return findLocalAnswer(userQuestion);
}

/**
 * Original local guide matching (kept as fallback)
 */
function findLocalAnswer(userQuestion: string): string {
  const normalizedQuestion = userQuestion.toLowerCase().trim().replace(/[?!.,]/g, '');
  
  // Tokenize the question (split into words, remove common filler words)
  const fillerWords = ['how', 'do', 'i', 'can', 'where', 'what', 'is', 'the', 'a', 'an', 'to', 'for', 'my', 'me', 'you', 'your'];
  const questionTokens = normalizedQuestion
    .split(/\s+/)
    .filter(word => word.length > 1 && !fillerWords.includes(word));
  
  // Score each guide based on keyword overlap using Jaccard similarity
  const scoredGuides = NAVIGATION_GUIDES.map(guide => {
    let bestScore = 0;
    let bestMatchLength = 0;
    
    // Try each keyword pattern
    for (const keyword of guide.question) {
      const keywordTokens = keyword.split(/\s+/).filter(t => t.length > 1);
      
      // Count exact whole-token matches (no substring matching)
      const matchedKeywords = keywordTokens.filter(kt => 
        questionTokens.some(qt => qt === kt)
      ).length;
      
      const matchedQuestion = questionTokens.filter(qt =>
        keywordTokens.some(kt => qt === kt)
      ).length;
      
      // Completeness: All keyword tokens must be in question
      const completeness = keywordTokens.length > 0 ? matchedKeywords / keywordTokens.length : 0;
      
      // Coverage: How much of the question is explained by the keyword?
      // Penalty for extra unmatched question tokens
      const coverage = questionTokens.length > 0 ? matchedQuestion / questionTokens.length : 0;
      
      // Specificity: Prefer longer, more specific patterns
      const specificity = keywordTokens.length;
      
      // Final score heavily weights bidirectional match quality
      // - Must match all keyword tokens (completeness)
      // - Should match most question tokens (coverage) 
      // - Longer patterns break ties
      const score = (completeness * 0.5) + (coverage * 0.4) + (Math.min(specificity / 5, 1) * 0.1);
      
      if (score > bestScore || (score === bestScore && specificity > bestMatchLength)) {
        bestScore = score;
        bestMatchLength = specificity;
      }
    }
    
    return { guide, score: bestScore, matchLength: bestMatchLength };
  }).filter(item => item.score > 0.3); // Require at least 30% match
  
  // Sort by score (highest first), then by match length (longer/more specific first)
  scoredGuides.sort((a, b) => {
    if (Math.abs(b.score - a.score) < 0.01) {
      return b.matchLength - a.matchLength;
    }
    return b.score - a.score;
  });
  
  if (scoredGuides.length === 0) {
    return "I'm not sure how to help with that specific question. Could you try asking:\n\n" +
      "- How do I add a client?\n" +
      "- How do I schedule an appointment?\n" +
      "- How do I create a task?\n" +
      "- How do I add library content?\n" +
      "- How do I write a session note?\n\n" +
      "Or ask about navigating to a specific section of TherapyFlow.";
  }
  
  // Return the highest scoring match - comprehensive info in chatbot
  return scoredGuides[0].guide.answer;
}

/**
 * Get contextual suggestions based on current page
 */
export function getContextualSuggestions(currentPage: string): string[] {
  const pageMap: Record<string, string[]> = {
    dashboard: [
      "How do I add a new client?",
      "How do I schedule an appointment?",
      "How do I create a task?"
    ],
    clients: [
      "How do I add a new client?",
      "How do I view a client's sessions?",
      "How do I edit client information?"
    ],
    scheduling: [
      "How do I schedule an appointment?",
      "How do I change calendar views?",
      "How do I cancel an appointment?"
    ],
    library: [
      "How do I add library content?",
      "How do I connect library entries?",
      "What are the library categories?"
    ],
    tasks: [
      "How do I create a task?",
      "How do I filter tasks?",
      "How do I mark a task complete?"
    ],
    billing: [
      "How do I add a service?",
      "How do I track payments?",
      "How do I add a room?"
    ],
    assessments: [
      "How do I create an assessment?",
      "How do I assign an assessment to a client?"
    ],
    portal: [
      "How do I give a client portal access?",
      "What can clients do in the portal?"
    ]
  };
  
  return pageMap[currentPage] || pageMap.dashboard;
}

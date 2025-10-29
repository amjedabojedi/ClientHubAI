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
    answer: "**How to Add a New Client:**\n\n**Required Fields:**\n• First Name & Last Name\n\n**Optional Fields:**\n• Email, Phone, Date of Birth\n• Address (Street, City, State, ZIP)\n• Status (Active, Inactive, Discharged, On Hold, Waitlist)\n• Risk Level (None, Low, Medium, High, Critical)\n• Assigned Therapist\n\n**Steps:**\n1. Click **Clients** → **+ Add Client** (top right)\n2. Fill in client information\n3. Click **Create Client**\n\n**💡 Tips:**\n• Add email to enable portal access and automated reminders\n• Set risk level for proper monitoring and alerts\n• Assign therapist for calendar/scheduling integration",
    category: "clients",
    helpGuideSlug: "add-client"
  },
  {
    question: ["view client", "see client", "find client", "client profile"],
    answer: "**How to View Client Profiles:**\n\n**Steps:**\n1. Click **Clients** in top navigation\n2. Use search box or browse the list\n3. Click client name to open full profile\n\n**Client Profile Tabs:**\n• Overview - Basic info, demographics, contact\n• Sessions - Session notes and history\n• Documents - Uploaded files and forms\n• Assessments - Assigned assessments and reports\n• Tasks - Client-related tasks\n• Portal Access - Login credentials and access settings\n• Billing - Payment history and invoices\n\n**💡 Quick Actions:**\n• Schedule appointment directly from profile\n• Add session note from Sessions tab\n• Upload documents via Documents tab",
    category: "clients",
    helpGuideSlug: "add-client"
  },
  {
    question: ["edit client", "update client", "change client"],
    answer: "**How to Edit Client Information:**\n\n**Steps:**\n1. Click **Clients** → Click client name\n2. Click **Edit** button in profile header\n3. Update information\n4. Click **Save**\n\n**What You Can Edit:**\n• Demographics (name, DOB, contact info)\n• Status and Risk Level\n• Assigned Therapist\n• Address and contact details\n\n**💡 Important:**\n• Changes are logged in HIPAA audit trail\n• Status changes affect client visibility in lists\n• Risk level changes trigger security notifications",
    category: "clients",
    helpGuideSlug: "edit-client"
  },
  
  // Scheduling
  {
    question: ["schedule appointment", "book session", "add appointment", "create session"],
    answer: "**How to Schedule an Appointment:**\n\n**Steps:**\n1. Click **Scheduling** → Choose view (Day/Week/Month)\n2. Click a time slot in the calendar\n3. Fill in appointment details\n4. Click **Create Session**\n\n**Required Fields:**\n• Client\n• Session Type (Initial, Follow-up, Group, etc.)\n• Service (from billing catalog)\n• Start Time & Duration\n• Location/Room\n\n**Session Statuses:**\n• Scheduled → Completed → Cancelled → Rescheduled → No Show\n\n**💡 Tips:**\n• Color-coded by session type for easy viewing\n• Drag sessions to reschedule in calendar\n• Double-click time slot for quick scheduling\n• Service selection auto-sets billing info",
    category: "scheduling",
    helpGuideSlug: "schedule-appointment"
  },
  {
    question: ["calendar view", "change view", "switch view"],
    answer: "**Calendar Views:**\n\n**📅 Day View** - Hourly breakdown, detailed schedule\n**📆 Week View** - 7-day overview, best for planning\n**🗓️ Month View** - Full month snapshot, high-level view\n\n**How to Switch:**\n• Click tabs at top of calendar\n• Use arrow buttons to navigate dates\n• Click \"Today\" to jump to current date\n\n**💡 Features:**\n• Color-coded by session type\n• Click any session to edit in-place\n• Filter by therapist or room\n• Export calendar to print schedules",
    category: "scheduling",
    helpGuideSlug: "schedule-appointment"
  },
  {
    question: ["cancel appointment", "delete session", "cancel session"],
    answer: "**How to Cancel/Reschedule:**\n\n**Cancel Appointment:**\n1. Click appointment on calendar\n2. Click **Edit** → Change status to **Cancelled**\n3. Add cancellation reason (optional)\n4. Click **Save**\n\n**Reschedule Appointment:**\n1. Drag session to new time slot, OR\n2. Edit session → Change date/time → Save\n\n**💡 Important:**\n• Cancelled sessions stay in system for records\n• Billing status updated automatically\n• Email notifications sent to client if enabled\n• Track no-shows separately from cancellations",
    category: "scheduling",
    helpGuideSlug: "schedule-appointment"
  },
  
  // Session Notes
  {
    question: ["add session note", "write note", "document session", "create note", "session note", "write session note", "create session note"],
    answer: "**How to Add a Session Note:**\n\n**Steps:**\n1. **Clients** → Click client → **Sessions** tab\n2. Click **+ Add Session Note**\n3. Fill in clinical documentation\n4. Click **Save Session Note**\n\n**Note Sections:**\n• Session Details (date, time, duration, type)\n• Mood Tracking (current mood, changes observed)\n• Goals & Progress\n• Interventions Used\n• Clinical Observations\n• **Risk Assessment** (10-factor matrix)\n• Treatment Plan Updates\n\n**Risk Assessment Factors:**\nSuicidal Ideation • Self-Harm • Homicidal Ideation • Psychosis • Substance Use • Impulsivity • Aggression/Violence • Trauma Symptoms • Non-Adherence • Support System\n\n**💡 Features:**\n• Auto-save every 30 seconds\n• Pick from Library content for quick documentation\n• Rich text formatting\n• HIPAA audit logging",
    category: "notes",
    helpGuideSlug: "add-session-note"
  },
  {
    question: ["ai note", "generate note", "ai help note"],
    answer: "**How to Use AI for Session Notes:**\n\n**Steps:**\n1. Open session note form\n2. Click **Generate with AI** button\n3. AI drafts note using OpenAI\n4. Review and edit generated content\n5. Click **Save Session Note**\n\n**AI Can Generate:**\n• Clinical observations from session details\n• Progress notes in professional format\n• Treatment recommendations\n• Structured SOAP notes\n\n**💡 AI Templates:**\n• Create reusable templates for common scenarios\n• Save templates for future use\n• Edit and customize AI output\n• All AI-generated notes fully editable",
    category: "notes",
    helpGuideSlug: "ai-note"
  },
  
  // Library
  {
    question: ["library", "add library", "library content", "clinical content"],
    answer: "**How to Add Library Content:**\n\n1. Click **Administration** dropdown → Select **Library**\n2. Choose a category tab: Session Focus, Symptoms, Goals, Interventions, or Progress\n3. Click **+ Add Entry**\n4. Enter your content\n5. Click **Save**",
    category: "library"
  },
  {
    question: ["connect library", "link library", "library connections"],
    answer: "**How to Connect Library Entries:**\n\n1. Go to **Administration** → **Library**\n2. Click on any entry\n3. Click the **Connect** button\n4. Select related entries from other categories\n5. Click **Save Connections**",
    category: "library"
  },
  
  // Tasks
  {
    question: ["create task", "add task", "new task"],
    answer: "**How to Create a Task:**\n\n**Steps:**\n1. Click **Tasks** in top navigation → **+ Add Task**\n2. Fill in required fields: Title, Description, **Client** (required), Assigned To, Due Date\n3. Set Priority level and initial Status\n4. Click **Create Task**\n\n**Priority Levels:**\n- 🔵 Low | 🟡 Medium | 🟠 High | 🔴 Urgent\n\n**Task Statuses:**\n- Pending → In Progress → Completed → Overdue (auto-set when past due)\n\n**💡 Tips:**\n• Tasks automatically show overdue when past their due date\n• Link tasks to clients to see them in client profiles\n• Add comments to track progress and communicate with team\n• Use filters to find tasks by status, priority, or assignee",
    category: "tasks",
    helpGuideSlug: "create-task"
  },
  {
    question: ["filter tasks", "search tasks", "find tasks"],
    answer: "**How to Filter Tasks:**\n\n**Quick Filters (Top of Tasks Page):**\n• **Status:** All | Pending | In Progress | Completed | Overdue\n• **Priority:** All | Low | Medium | High | Urgent\n• **Assigned To:** Filter by team member\n• **Client:** See tasks for specific client\n\n**💡 Tips:**\n• Filters combine - use multiple at once to narrow results\n• Overdue tasks automatically highlighted in red\n• Results update instantly as you change filters\n• Export filtered task lists for reports",
    category: "tasks",
    helpGuideSlug: "create-task"
  },
  {
    question: ["complete task", "mark task done", "finish task"],
    answer: "**How to Complete a Task:**\n\n**Quick Method:**\n1. Go to **Tasks** page → Find your task\n2. Click the task to open details\n3. Change Status to **Completed**\n4. Click **Save**\n\n**💡 Good Practice:**\n• Add a final comment noting completion details\n• Update progress notes before marking complete\n• Completed tasks stay visible in task list for records\n• Use filters to hide completed tasks from daily view",
    category: "tasks",
    helpGuideSlug: "create-task"
  },
  
  // Billing
  {
    question: ["add service", "billing service", "create service"],
    answer: "**How to Add a Billing Service:**\n\n**Steps:**\n1. **Billing** → **Services** tab → **+ Add Service**\n2. Enter service details\n3. Click **Create**\n\n**Service Fields:**\n• Name (e.g., \"Individual Therapy\")\n• CPT Code (e.g., \"90834\")\n• Price (default rate)\n• Duration (minutes)\n\n**💡 Tips:**\n• Services auto-populate when scheduling sessions\n• Link services to insurance codes for claims\n• Set different rates for different service types\n• Services appear in billing reports and invoices",
    category: "billing",
    helpGuideSlug: "create-invoice"
  },
  {
    question: ["add room", "create room", "billing room"],
    answer: "**How to Add a Room:**\n\n**Steps:**\n1. **Billing** → **Rooms** tab → **+ Add Room**\n2. Enter room name and details\n3. Click **Create**\n\n**💡 Purpose:**\n• Track which room used for each session\n• Filter calendar by room availability\n• Room data included in billing records\n• Helpful for multi-location practices",
    category: "billing",
    helpGuideSlug: "create-invoice"
  },
  {
    question: ["payment status", "track payments", "billing sessions"],
    answer: "**How to Track Payments:**\n\n**View Payment Status:**\n• **Billing** → **Sessions** tab\n\n**Payment Statuses:**\n• 🟢 **Paid** - Payment received\n• 🟡 **Billed** - Invoice sent, awaiting payment\n• 🔵 **Pending** - Session completed, not yet billed\n• 🔴 **Denied** - Claim denied by insurance\n• 🟣 **Refunded** - Payment refunded to client\n• 🟠 **Follow Up** - Requires attention\n\n**💡 Features:**\n• Filter by date range and status\n• Export for accounting reports\n• Stripe integration for online payments\n• Automatic status updates when payments received",
    category: "billing",
    helpGuideSlug: "create-invoice"
  },
  
  // Assessments
  {
    question: ["create assessment", "assessment template", "add assessment"],
    answer: "**How to Create Assessment Templates:**\n\n**Steps:**\n1. **Administration** → **Assessments** → **+ Create Template**\n2. Enter template details and questions\n3. Click **Save Template**\n\n**Template Fields:**\n• Template Name & Description\n• Question Type (Text, Multiple Choice, Rating Scale)\n• Question text and options\n\n**💡 Features:**\n• Reusable templates for all clients\n• Multiple question types supported\n• Templates can be edited anytime\n• Track completion rates and responses",
    category: "assessments"
  },
  {
    question: ["assign assessment", "give assessment to client"],
    answer: "**How to Assign Assessments:**\n\n**Steps:**\n1. **Clients** → Click client → **Assessments** tab\n2. Click **Assign Assessment**\n3. Select template and set due date\n4. Click **Assign**\n\n**Assessment Workflow:**\n1. **Pending** - Assigned, waiting for client\n2. **Client In Progress** - Client started, not finished\n3. **Waiting for Therapist** - Client submitted, needs review\n4. **Therapist Completed** - AI report generated, in draft\n5. **Completed** - Finalized with digital signature\n\n**💡 Features:**\n• Client completes via portal\n• AI generates professional reports\n• Auto-save every 30 seconds\n• Export to PDF or Word\n• Digital signatures for compliance",
    category: "assessments"
  },
  
  // Client Portal
  {
    question: ["client portal", "give client access", "portal access"],
    answer: "**How to Enable Client Portal:**\n\n**Steps:**\n1. **Clients** → Click client → **Portal Access** tab\n2. Toggle **Enable Portal Access** ON\n3. System auto-generates username/password\n4. Click **Send Welcome Email**\n\n**What Clients Can Do:**\n• View appointments and schedule\n• Upload documents securely\n• View and pay invoices (Stripe)\n• Complete assigned assessments\n• Update contact information\n\n**💡 Security:**\n• Unique login credentials per client\n• All access HIPAA audit logged\n• Clients see only their own data\n• Portal timezone: America/New_York",
    category: "portal"
  },
  
  // User Management
  {
    question: ["add user", "create user", "new staff"],
    answer: "**How to Add Staff Users:**\n\n**Steps:**\n1. **Administration** → **User Profiles** → **+ Add User**\n2. Fill in user information\n3. Select role and permissions\n4. Click **Create User**\n\n**User Roles:**\n• Admin - Full system access\n• Supervisor - Manage team, view all clients\n• Therapist - Manage own clients and sessions\n• Billing - Access billing and payments only\n\n**💡 Permissions:**\n• 15 granular permissions per role\n• Customize access by feature\n• Role-based navigation visibility",
    category: "admin"
  },
  {
    question: ["my profile", "change password", "update my info"],
    answer: "**How to Manage Your Profile:**\n\n**Steps:**\n1. Click your name (top right) → **My Profile**\n2. Edit your information\n3. Click **Save Changes**\n\n**Profile Tabs:**\n• **Personal Info** - Name, email, phone\n• **Credentials** - 9 license types (LCSW, LMFT, PhD, etc.)\n• **Professional Details** - Bio, specialties, education\n• **Working Hours** - Set availability for scheduling\n• **Zoom Integration** - Connect for virtual sessions\n• **Security** - Change password\n• **Notifications** - Email preferences\n• **Signature** - Upload digital signature\n\n**💡 Features:**\n• Working hours control appointment availability\n• Credentials display on reports\n• Signature auto-applies to documents",
    category: "profile"
  },
  
  // Navigation & General
  {
    question: ["dashboard", "home", "main page"],
    answer: "**Dashboard Overview:**\n\n**Quick Stats:**\n• Total Active Clients\n• Appointments Today\n• Pending Tasks\n• Outstanding Payments\n\n**Sections:**\n• **Upcoming Appointments** - Next 5 sessions\n• **Recent Activity** - Latest client updates\n• **Task Alerts** - Overdue and urgent tasks\n• **Quick Actions** - Add client, schedule, create task\n\n**💡 Access:**\nClick **Dashboard** in top navigation anytime",
    category: "navigation"
  },
  {
    question: ["administration", "admin menu", "settings"],
    answer: "**Administration Menu:**\n\n**Access:** Click **Administration** in top navigation\n\n**Available Modules:**\n• **Library** - Clinical content management\n• **Assessments** - Template management\n• **Process Checklists** - Workflow templates\n• **User Profiles** - Staff management\n• **Role Management** - Permission settings\n• **Notifications** - Email configuration\n• **HIPAA Audit** - Security logs\n• **Settings** - System configuration\n\n**💡 Permissions:**\nOnly visible to Admin and Supervisor roles\nEach module requires specific permissions",
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

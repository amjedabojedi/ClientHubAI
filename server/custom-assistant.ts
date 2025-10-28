/**
 * Custom TherapyFlow Navigation Assistant
 * No OpenAI - pure rule-based navigation help using actual app structure
 */

interface NavigationGuide {
  question: string[];
  answer: string;
  category: string;
}

// Knowledge base of actual TherapyFlow navigation - built from real app structure
const NAVIGATION_GUIDES: NavigationGuide[] = [
  // Client Management
  {
    question: ["add client", "new client", "create client"],
    answer: "1. Click **Clients** in the top navigation\n2. Click the **Add Client** button (top right)\n3. Fill in required fields: First Name, Last Name\n4. Optional: Email, Phone, DOB, Address, Status, Risk Level, Assigned Therapist\n5. Click **Create Client**",
    category: "clients"
  },
  {
    question: ["view client", "see client", "find client", "client profile"],
    answer: "1. Click **Clients** in the top navigation\n2. Use the search box or scroll to find the client\n3. Click on the client's name to open their profile",
    category: "clients"
  },
  {
    question: ["edit client", "update client", "change client"],
    answer: "1. Click **Clients** → Click the client's name\n2. Click the **Edit** button in the client profile\n3. Make your changes\n4. Click **Save**",
    category: "clients"
  },
  
  // Scheduling
  {
    question: ["schedule appointment", "book session", "add appointment", "create session"],
    answer: "1. Click **Scheduling** in the top navigation\n2. Choose Day/Week/Month view (tabs at top)\n3. Click on a time slot in the calendar\n4. Fill in: Client, Session Type, Service, Start Time, Duration, Location/Room\n5. Click **Create Session**",
    category: "scheduling"
  },
  {
    question: ["calendar view", "change view", "switch view"],
    answer: "1. Go to **Scheduling** page\n2. At the top of the calendar, click the tabs: **Day**, **Week**, or **Month**\n3. The calendar will switch to that view",
    category: "scheduling"
  },
  {
    question: ["cancel appointment", "delete session", "cancel session"],
    answer: "1. Go to **Scheduling** → Find the appointment on the calendar\n2. Click on the appointment\n3. Click **Edit** or the action menu (⋮)\n4. Choose **Cancel** or **Delete**\n5. Confirm the action",
    category: "scheduling"
  },
  
  // Session Notes
  {
    question: ["add session note", "write note", "document session", "create note", "session note", "write session note", "create session note"],
    answer: "1. Click **Clients** → Click the client's name\n2. In their profile, click the **Sessions** tab\n3. Click **+ Add Session Note**\n4. Fill in: Session Date, Time, Duration, Session Type, clinical details\n5. Click **Save Session Note**",
    category: "notes"
  },
  {
    question: ["ai note", "generate note", "ai help note"],
    answer: "1. When adding a session note, look for the **Generate with AI** button\n2. Click it to get AI assistance drafting the note\n3. Review and edit the generated content\n4. Click **Save Session Note**",
    category: "notes"
  },
  
  // Library
  {
    question: ["library", "add library", "library content", "clinical content"],
    answer: "1. Click **Administration** dropdown → Select **Library**\n2. Choose a category tab: Session Focus, Symptoms, Goals, Interventions, or Progress\n3. Click **+ Add Entry**\n4. Enter your content\n5. Click **Save**",
    category: "library"
  },
  {
    question: ["connect library", "link library", "library connections"],
    answer: "1. Go to **Administration** → **Library**\n2. Click on any entry\n3. Click the **Connect** button\n4. Select related entries from other categories\n5. Click **Save Connections**",
    category: "library"
  },
  
  // Tasks
  {
    question: ["create task", "add task", "new task"],
    answer: "1. Click **Tasks** in the top navigation\n2. Click **+ Add Task** button\n3. Fill in: Title, Description, Due Date, Priority, Assigned To\n4. Optional: Link to a specific client\n5. Click **Create Task**",
    category: "tasks"
  },
  {
    question: ["filter tasks", "search tasks", "find tasks"],
    answer: "1. Go to **Tasks** page\n2. Use the filters at the top:\n   - Status: All/Pending/In Progress/Completed\n   - Priority: All/Low/Medium/High/Urgent\n   - Assigned To: Select a user\n3. Results update automatically",
    category: "tasks"
  },
  {
    question: ["complete task", "mark task done", "finish task"],
    answer: "1. Go to **Tasks** → Find your task\n2. Click on the task to open it\n3. Change status to **Completed**\n4. Click **Save** or use the quick action button",
    category: "tasks"
  },
  
  // Billing
  {
    question: ["add service", "billing service", "create service"],
    answer: "1. Click **Billing** in the top navigation\n2. Click the **Services** tab\n3. Click **+ Add Service**\n4. Enter: Name, Code, Price, Duration\n5. Click **Create**",
    category: "billing"
  },
  {
    question: ["add room", "create room", "billing room"],
    answer: "1. Go to **Billing** page\n2. Click the **Rooms** tab\n3. Click **+ Add Room**\n4. Enter room details\n5. Click **Create**",
    category: "billing"
  },
  {
    question: ["payment status", "track payments", "billing sessions"],
    answer: "1. Go to **Billing** page\n2. Click the **Sessions** tab\n3. You'll see all sessions with payment status: Paid, Pending, or Unpaid\n4. Use filters to narrow down by date or status",
    category: "billing"
  },
  
  // Assessments
  {
    question: ["create assessment", "assessment template", "add assessment"],
    answer: "1. Click **Administration** → **Assessments**\n2. Click **+ Create Template**\n3. Enter: Template Name, Description, add questions\n4. Click **Save Template**",
    category: "assessments"
  },
  {
    question: ["assign assessment", "give assessment to client"],
    answer: "1. Click **Clients** → Click the client's name\n2. Go to **Assessments** tab in their profile\n3. Click **Assign Assessment**\n4. Select the template and set due date\n5. Click **Assign**",
    category: "assessments"
  },
  
  // Client Portal
  {
    question: ["client portal", "give client access", "portal access"],
    answer: "1. Go to **Clients** → Click the client's name\n2. Click the **Portal Access** tab\n3. Toggle **Enable Portal Access**\n4. System generates login credentials\n5. Click **Send Welcome Email** to notify the client",
    category: "portal"
  },
  
  // User Management
  {
    question: ["add user", "create user", "new staff"],
    answer: "1. Click **Administration** → **User Profiles**\n2. Click **+ Add User**\n3. Fill in: Full Name, Username, Email, Role\n4. Set credentials\n5. Click **Create User**",
    category: "admin"
  },
  {
    question: ["my profile", "change password", "update my info"],
    answer: "1. Click your name in the top right corner\n2. Select **My Profile** from the dropdown\n3. Edit your information\n4. Click **Save Changes**",
    category: "profile"
  },
  
  // Navigation & General
  {
    question: ["dashboard", "home", "main page"],
    answer: "Click **Dashboard** in the top navigation bar to return to the main overview page.",
    category: "navigation"
  },
  {
    question: ["administration", "admin menu", "settings"],
    answer: "Click **Administration** in the top navigation to access:\n- Library\n- Assessments\n- Process Checklists\n- User Profiles\n- Role Management\n- Notifications\n- HIPAA Audit\n- Settings\n\n(Only visible to Admin and Supervisor roles)",
    category: "navigation"
  },
];

/**
 * Find the best matching answer for a user's question
 * Uses token-based matching with Jaccard similarity for accuracy
 */
export function findAnswer(userQuestion: string): string {
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
  
  // Return the highest scoring match
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

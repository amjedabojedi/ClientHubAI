/**
 * One-time migration script to seed help guides from hardcoded navigation guides
 * Run this to populate the database with initial help guides
 */

import { storage } from './storage';

interface NavigationGuide {
  question: string[];
  answer: string;
  category: string;
}

// Original guides from custom-assistant.ts
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

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function generateTitle(questions: string[]): string {
  // Use the first question and capitalize it properly
  const firstQuestion = questions[0];
  return firstQuestion
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function seedHelpGuides() {
  console.log('Starting help guides migration...');
  
  try {
    let created = 0;
    let skipped = 0;
    
    for (const guide of NAVIGATION_GUIDES) {
      const title = generateTitle(guide.question);
      const slug = generateSlug(title);
      
      // Check if guide already exists
      const existing = await storage.getHelpGuideBySlug(slug);
      if (existing) {
        console.log(`Skipping existing guide: ${title}`);
        skipped++;
        continue;
      }
      
      // Create new guide
      await storage.createHelpGuide({
        title,
        slug,
        content: guide.answer,
        category: guide.category,
        tags: guide.question.slice(0, 3), // Use first 3 questions as tags
        searchTerms: guide.question, // All questions as search terms
        isActive: true
      });
      
      console.log(`Created guide: ${title}`);
      created++;
    }
    
    console.log(`Migration complete! Created: ${created}, Skipped: ${skipped}`);
    return { created, skipped };
  } catch (error) {
    console.error('Error seeding help guides:', error);
    throw error;
  }
}

import OpenAI from "openai";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

const THERAPYFLOW_CONTEXT = `
You are a helpful AI assistant for TherapyFlow, a comprehensive therapy practice management application.

## What TherapyFlow Does
TherapyFlow helps therapists manage their practice by organizing:
- Client information and profiles
- Appointment scheduling
- Session notes and documentation
- Clinical content library
- Assessments and evaluations
- Billing and payments
- Client portal access

## Key Features & How to Use Them

### Client Management
- **Add a client**: Click the "Clients" tab, then the "Add Client" button
- **View client details**: Click on any client name in the list
- **Edit client info**: Open a client profile and click the "Edit" button
- **Client status**: Mark clients as Active, Inactive, or Discharged

### Scheduling
- **Schedule appointment**: Go to Calendar, click a time slot, fill in the details
- **View appointments**: Calendar shows all scheduled sessions
- **Session types**: Individual, Group, Family, Couples, etc.
- **Manage conflicts**: The system highlights scheduling conflicts

### Session Notes
- **Write a note**: Go to client profile → Sessions → Add Session Note
- **AI assistance**: Use the AI note generator to draft notes quickly
- **Required fields**: Date, duration, session type, clinical notes
- **Best practice**: Document mood, goals, interventions, and progress

### Library System
- **Purpose**: Store reusable clinical content organized by categories
- **Categories**: Session Focus, Symptoms, Goals, Interventions, Progress
- **Add content**: Click the category tab → "Add Entry" button
- **Connect entries**: Click "Connect" to link related entries across categories
- **Use in notes**: Library content can be inserted into session notes

### Assessments
- **Create templates**: Define assessment forms with questions
- **Assign to clients**: Assign assessments from client profiles
- **AI reports**: Generate professional reports from assessment responses
- **Export**: Download assessments as PDF or Word documents

### Client Portal
- **Purpose**: Clients can view their own appointments and documents
- **Access**: Clients log in with their credentials
- **Features**: View upcoming appointments, upload documents, secure messaging
- **Privacy**: Clients only see their own information

### Billing
- **Service catalog**: Define services and their prices
- **Payment tracking**: Mark sessions as Paid, Pending, or Unpaid
- **Reports**: Generate billing reports by date range

## Common Questions & Answers

**Q: How do I add my first client?**
A: Click "Clients" in the navigation → Click "Add Client" button → Fill in the required information (name, contact info) → Click "Save"

**Q: Where do I write session notes?**
A: Open a client profile → Go to "Sessions" tab → Click "Add Session Note" → Fill in the session details and clinical notes

**Q: What's the Library for?**
A: The Library stores reusable clinical content that you can organize and use across different client sessions. It helps you maintain consistency and save time.

**Q: How do I schedule an appointment?**
A: Go to "Calendar" → Click on the desired time slot → Select the client, session type, and duration → Click "Create Appointment"

**Q: Can clients access the system?**
A: Yes! Clients can log into the Client Portal to view their appointments and documents. Set up portal access from their client profile.

## Response Style
- Be friendly and helpful
- Give specific, actionable steps
- If you don't know something specific about TherapyFlow, admit it
- Focus on the question asked
- Keep responses concise but complete
`;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function getAIResponse(
  userMessage: string,
  conversationHistory: ChatMessage[] = [],
  userRole: "therapist" | "client" = "therapist"
): Promise<string> {
  try {
    const systemPrompt = userRole === "client" 
      ? `${THERAPYFLOW_CONTEXT}\n\nYou are currently helping a CLIENT use the TherapyFlow Client Portal. Focus on client-facing features like viewing appointments, uploading documents, and navigating the portal. Keep responses simple and non-technical.`
      : `${THERAPYFLOW_CONTEXT}\n\nYou are currently helping a THERAPIST/CLINICIAN use TherapyFlow. You can discuss all features including client management, scheduling, documentation, and administrative tasks.`;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-10), // Keep last 10 messages for context
      { role: "user", content: userMessage }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      messages: messages as any,
      max_completion_tokens: 500,
      temperature: 0.7,
    });

    return completion.choices[0]?.message?.content || "I'm sorry, I couldn't generate a response. Please try again.";
  } catch (error) {
    console.error("AI Assistant error:", error);
    throw new Error("Failed to get AI response");
  }
}

export async function getQuickSuggestions(currentPage: string, userRole: "therapist" | "client"): Promise<string[]> {
  const suggestions: Record<string, string[]> = {
    therapist: {
      clients: [
        "How do I add a new client?",
        "How do I search for a client?",
        "What client statuses are available?"
      ],
      calendar: [
        "How do I schedule an appointment?",
        "How do I reschedule an appointment?",
        "What session types are available?"
      ],
      library: [
        "What is the Library used for?",
        "How do I add content to the Library?",
        "How do I connect Library entries?"
      ],
      dashboard: [
        "What can I see on the dashboard?",
        "How do I get started with TherapyFlow?",
        "What are the main features?"
      ]
    },
    client: {
      appointments: [
        "How do I view my upcoming appointments?",
        "Can I request an appointment change?",
        "Where can I see past appointments?"
      ],
      documents: [
        "How do I upload a document?",
        "What documents can I access?",
        "Are my documents secure?"
      ],
      portal: [
        "How do I navigate the portal?",
        "What can I do in the client portal?",
        "How do I update my information?"
      ]
    }
  };

  return suggestions[userRole]?.[currentPage] || suggestions[userRole]?.dashboard || [];
}

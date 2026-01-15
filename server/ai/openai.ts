import OpenAI from "openai";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

// This is using Replit's AI Integrations service, which provides OpenAI-compatible API access without requiring your own OpenAI API key.
// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  timeout: 120000, // 120 seconds timeout for long-running requests
  maxRetries: 2
});

// Separate client for Whisper audio transcription (requires direct OpenAI API access)
// Replit's AI Integration proxy doesn't support the /audio/transcriptions endpoint
// IMPORTANT: Must use OPENAI_WHISPER_API_KEY because Replit overrides OPENAI_API_KEY with its service account key
function getWhisperClient(): OpenAI {
  const whisperApiKey = process.env.OPENAI_WHISPER_API_KEY;
  
  if (!whisperApiKey) {
    console.error('[AI] OPENAI_WHISPER_API_KEY is not set. Voice transcription requires a personal OpenAI API key.');
    throw new Error('Voice transcription requires a personal OpenAI API key. Please set OPENAI_WHISPER_API_KEY in Replit Secrets.');
  }
  
  // Log key prefix for debugging (never log full key)
  console.log(`[AI] Using Whisper API key starting with: ${whisperApiKey.substring(0, 10)}...`);
  
  // Always create a fresh client to ensure we use the current API key from environment
  return new OpenAI({
    apiKey: whisperApiKey,
    timeout: 120000,
    maxRetries: 2
    // No baseURL - uses direct OpenAI API (not Replit proxy)
  });
}

// Clinical Content Library - Connected templates for intelligent field suggestions
export const clinicalTemplates = {
  'cognitive_behavioral': {
    name: 'Cognitive Behavioral Therapy (CBT)',
    description: 'Focus on thought patterns, cognitive restructuring, and behavioral interventions',
    
    // Session Focus Options
    sessionFocusOptions: {
      'anxiety_management': {
        label: 'Anxiety Management',
        template: 'Explored cognitive patterns related to anxiety. Identified negative thought cycles and worked on cognitive restructuring techniques for anxiety reduction.',
        connects: {
          symptoms: 'anxiety_symptoms',
          intervention: 'cbt_anxiety_interventions',
          progress: 'anxiety_progress',
          recommendations: 'anxiety_recommendations'
        }
      },
      'depression_treatment': {
        label: 'Depression Treatment',
        template: 'Addressed depressive thought patterns and behavioral activation. Focused on cognitive restructuring for negative self-talk and mood improvement.',
        connects: {
          symptoms: 'depression_symptoms',
          intervention: 'cbt_depression_interventions',
          progress: 'depression_progress',
          recommendations: 'depression_recommendations'
        }
      },
      'trauma_processing': {
        label: 'Trauma Processing',
        template: 'Explored trauma-related cognitive distortions and safety mechanisms. Worked on processing traumatic memories using CBT techniques.',
        connects: {
          symptoms: 'trauma_symptoms',
          intervention: 'cbt_trauma_interventions',
          progress: 'trauma_progress',
          recommendations: 'trauma_recommendations'
        }
      }
    },

    // Symptoms connected to session focus
    symptomsOptions: {
      'anxiety_symptoms': {
        label: 'Anxiety Symptoms',
        template: 'Client presented with elevated anxiety including physical symptoms (racing heart, sweating), cognitive symptoms (catastrophic thinking, worry), and behavioral avoidance patterns.'
      },
      'depression_symptoms': {
        label: 'Depression Symptoms', 
        template: 'Client reported depressive symptoms including low mood, decreased energy, negative self-talk, sleep disturbances, and reduced interest in activities.'
      },
      'trauma_symptoms': {
        label: 'Trauma Symptoms',
        template: 'Trauma symptoms included hypervigilance, intrusive thoughts, emotional numbing, dissociative episodes, and avoidance of trauma-related triggers.'
      }
    },

    // Interventions connected to focus areas
    interventionOptions: {
      'cbt_anxiety_interventions': {
        label: 'CBT Anxiety Interventions',
        template: 'Applied cognitive restructuring for catastrophic thoughts, taught breathing techniques, practiced thought challenging worksheets, and implemented gradual exposure planning.'
      },
      'cbt_depression_interventions': {
        label: 'CBT Depression Interventions', 
        template: 'Used behavioral activation techniques, challenged negative self-statements, implemented activity scheduling, and practiced cognitive reframing exercises.'
      },
      'cbt_trauma_interventions': {
        label: 'CBT Trauma Interventions',
        template: 'Utilized cognitive processing techniques, implemented grounding exercises, practiced trauma-focused cognitive restructuring, and worked on safety planning.'
      }
    },

    // Progress tracking connected to interventions
    progressOptions: {
      'anxiety_progress': {
        label: 'Anxiety Progress',
        template: 'Client demonstrated improved ability to identify and challenge anxious thoughts. Reduced avoidance behaviors and increased use of coping strategies in anxiety-provoking situations.'
      },
      'depression_progress': {
        label: 'Depression Progress',
        template: 'Client showed increased engagement in pleasurable activities, improved mood regulation, and better recognition of negative thought patterns with successful challenging.'
      },
      'trauma_progress': {
        label: 'Trauma Progress',
        template: 'Client exhibited decreased trauma reactivity, improved grounding skills, and increased capacity to discuss traumatic experiences without overwhelming distress.'
      }
    },

    // Recommendations connected to progress
    recommendationsOptions: {
      'anxiety_recommendations': {
        label: 'Anxiety Recommendations',
        template: 'Continue CBT anxiety protocol with daily thought records, practice exposure exercises between sessions, implement relaxation techniques, and monitor anxiety levels using rating scales.'
      },
      'depression_recommendations': {
        label: 'Depression Recommendations',
        template: 'Maintain behavioral activation schedule, continue mood monitoring, practice cognitive restructuring techniques daily, and increase social engagement activities.'
      },
      'trauma_recommendations': {
        label: 'Trauma Recommendations',
        template: 'Continue trauma-focused CBT sessions, practice grounding techniques daily, maintain safety planning, and gradually increase trauma processing work as tolerated.'
      }
    }
  },

  'trauma_focused': {
    name: 'Trauma-Focused Therapy',
    description: 'Specialized approach for trauma processing and PTSD treatment',
    
    sessionFocusOptions: {
      'trauma_stabilization': {
        label: 'Trauma Stabilization',
        template: 'Focused on safety, stabilization, and developing coping resources. Worked on building distress tolerance and emotional regulation skills.',
        connects: {
          symptoms: 'ptsd_symptoms',
          intervention: 'stabilization_interventions',
          progress: 'stabilization_progress',
          recommendations: 'stabilization_recommendations'
        }
      },
      'trauma_processing': {
        label: 'Trauma Processing',
        template: 'Engaged in direct trauma processing work. Focused on integrating traumatic memories and reducing trauma-related distress.',
        connects: {
          symptoms: 'processing_symptoms',
          intervention: 'processing_interventions',
          progress: 'processing_progress',
          recommendations: 'processing_recommendations'
        }
      }
    },

    symptomsOptions: {
      'ptsd_symptoms': {
        label: 'PTSD Symptoms',
        template: 'Client presented with PTSD symptoms including intrusive memories, nightmares, hypervigilance, emotional numbing, and avoidance of trauma reminders.'
      },
      'processing_symptoms': {
        label: 'Processing Symptoms',
        template: 'During processing work, client experienced manageable activation including emotional flooding, dissociative episodes, and somatic trauma responses.'
      }
    },

    interventionOptions: {
      'stabilization_interventions': {
        label: 'Stabilization Interventions',
        template: 'Implemented grounding techniques, taught emotional regulation skills, practiced breathing exercises, and established safety planning protocols.'
      },
      'processing_interventions': {
        label: 'Processing Interventions',
        template: 'Utilized EMDR bilateral stimulation, implemented CPT cognitive processing techniques, and guided trauma narrative development with titrated exposure.'
      }
    },

    progressOptions: {
      'stabilization_progress': {
        label: 'Stabilization Progress',
        template: 'Client demonstrated improved emotional regulation, decreased dissociative episodes, and increased capacity to use grounding techniques effectively.'
      },
      'processing_progress': {
        label: 'Processing Progress',
        template: 'Client showed reduced emotional charge around traumatic memories, improved narrative coherence, and decreased avoidance of trauma-related triggers.'
      }
    },

    recommendationsOptions: {
      'stabilization_recommendations': {
        label: 'Stabilization Recommendations',
        template: 'Continue stabilization phase work, practice grounding techniques daily, maintain safety planning, and monitor dissociative symptoms closely.'
      },
      'processing_recommendations': {
        label: 'Processing Recommendations',
        template: 'Continue trauma processing sessions, practice self-care between sessions, monitor trauma symptoms, and prepare for integration phase work.'
      }
    }
  },

  'mindfulness_based': {
    name: 'Mindfulness-Based Therapy',
    description: 'Integration of mindfulness practices with therapeutic interventions',
    
    sessionFocusOptions: {
      'mindfulness_training': {
        label: 'Mindfulness Training',
        template: 'Practiced core mindfulness techniques including breath awareness, body scanning, and present-moment attention skills.',
        connects: {
          symptoms: 'mindfulness_symptoms',
          intervention: 'mindfulness_interventions',
          progress: 'mindfulness_progress',
          recommendations: 'mindfulness_recommendations'
        }
      },
      'emotional_regulation': {
        label: 'Emotional Regulation',
        template: 'Focused on using mindfulness for emotional regulation, distress tolerance, and reducing emotional reactivity.',
        connects: {
          symptoms: 'emotional_symptoms',
          intervention: 'regulation_interventions',
          progress: 'regulation_progress',
          recommendations: 'regulation_recommendations'
        }
      }
    },

    symptomsOptions: {
      'mindfulness_symptoms': {
        label: 'Mindfulness-Related Symptoms',
        template: 'Client reported difficulty with present-moment awareness, mind wandering, rumination patterns, and challenges with acceptance of current experiences.'
      },
      'emotional_symptoms': {
        label: 'Emotional Dysregulation',
        template: 'Client experienced emotional overwhelm, difficulty managing intense emotions, reactive responses to triggers, and challenges with distress tolerance.'
      }
    },

    interventionOptions: {
      'mindfulness_interventions': {
        label: 'Mindfulness Interventions',
        template: 'Guided breathing meditation, body scan exercises, mindful movement practices, and awareness of thoughts and emotions without judgment.'
      },
      'regulation_interventions': {
        label: 'Emotional Regulation Interventions',
        template: 'Taught STOP technique, implemented loving-kindness meditation, practiced distress tolerance skills, and used mindful self-compassion exercises.'
      }
    },

    progressOptions: {
      'mindfulness_progress': {
        label: 'Mindfulness Progress',
        template: 'Client demonstrated increased present-moment awareness, improved ability to observe thoughts without attachment, and reduced rumination patterns.'
      },
      'regulation_progress': {
        label: 'Emotional Regulation Progress',
        template: 'Client showed improved emotional regulation skills, increased distress tolerance, and better ability to respond rather than react to triggers.'
      }
    },

    recommendationsOptions: {
      'mindfulness_recommendations': {
        label: 'Mindfulness Recommendations',
        template: 'Continue daily mindfulness practice, use mindfulness apps for guided sessions, integrate mindful moments throughout the day, and maintain meditation journal.'
      },
      'regulation_recommendations': {
        label: 'Emotional Regulation Recommendations',
        template: 'Practice emotional regulation techniques daily, use mindfulness during triggering situations, continue self-compassion exercises, and monitor emotional patterns.'
      }
    }
  }
};

interface SessionNoteAIRequest {
  sessionFocus?: string;
  symptoms?: string;
  shortTermGoals?: string;
  intervention?: string;
  progress?: string;
  remarks?: string;
  recommendations?: string;

  customPrompt?: string;
  clientName?: string;
  sessionType?: string;
  sessionDate?: string;
  selectedTemplate?: string;
}

interface AIGeneratedContent {
  generatedContent: string;
  suggestions: {
    sessionFocus?: string[];
    symptoms?: string[];
    interventions?: string[];
    goals?: string[];
    progress?: string[];
  };
}

// Generate AI template based on custom instructions
export async function generateAITemplate(
  clientData: any,
  sessionData: any,
  formData: any,
  customInstructions: string
): Promise<{ generatedContent: string }> {
  try {
    const prompt = `You are a professional clinical therapist AI assistant specializing in session note documentation.

CLIENT INFORMATION:
- Name: ${clientData?.fullName || 'Client'}
- Client ID: ${clientData?.clientId || 'Not specified'}
- Age: ${clientData?.dateOfBirth ? new Date().getFullYear() - new Date(clientData.dateOfBirth).getFullYear() : 'Not specified'}
- Gender: ${clientData?.gender || 'Not specified'}
- Treatment Stage: ${clientData?.stage || 'Not specified'}

SESSION INFORMATION:
- Date: ${sessionData?.sessionDate ? format(new Date(sessionData.sessionDate), 'MMM dd, yyyy') : 'Not specified'}
- Type: ${sessionData?.sessionType || 'Not specified'}
- Duration: ${sessionData?.duration || 'Not specified'} minutes

EXISTING FORM DATA:
- Session Focus: ${formData?.sessionFocus || 'Not filled'}
- Symptoms: ${formData?.symptoms || 'Not filled'}
- Short-term Goals: ${formData?.shortTermGoals || 'Not filled'}
- Interventions: ${formData?.intervention || 'Not filled'}
- Progress: ${formData?.progress || 'Not filled'}
- Additional Notes: ${formData?.remarks || 'None'}

CUSTOM INSTRUCTIONS FROM THERAPIST:
${customInstructions}

Based on the above information and custom instructions, generate a comprehensive, professional session note template. Follow these guidelines:

1. Use professional clinical language appropriate for mental health documentation
2. Structure the content logically and clearly
3. Include all relevant sections based on the form fields
4. Follow the specific instructions provided by the therapist
5. Make the content specific to this client and session
6. Ensure compliance with clinical documentation standards
7. Use the existing form data when available, but expand and enhance it
8. DO NOT use any markdown formatting - no ** bold text **, no --- separators, no # headers
9. Use plain text only with clear section breaks using line breaks

Generate a complete session note template that can be used directly for clinical documentation. Format it as plain text without any markdown formatting.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are a professional clinical therapist AI assistant. Generate comprehensive, professional session note templates in plain text format only. Do not use markdown formatting such as ** for bold, --- for separators, or # for headers. Use clear section breaks with line spacing only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });

    let generatedContent = response.choices[0].message.content || "Failed to generate content";
    
    // Remove any markdown formatting that might have slipped through
    generatedContent = generatedContent
      .replace(/\*\*(.*?)\*\*/g, '$1')  // Remove bold formatting
      .replace(/^\s*---+\s*$/gm, '')   // Remove horizontal rules
      .replace(/^#+\s+/gm, '')         // Remove header markers
      .replace(/\*\s+/g, '• ')         // Convert asterisk lists to bullet points
      .replace(/^\s*\d+\.\s+/gm, '')   // Remove numbered list markers
      .trim();

    return {
      generatedContent
    };
  } catch (error) {
    throw new Error("Failed to generate AI template: " + (error as Error).message);
  }
}

export async function generateSessionNoteSummary(data: SessionNoteAIRequest): Promise<AIGeneratedContent> {
  const systemPrompt = `You are a professional clinical psychologist assistant. Generate comprehensive session notes in third-person clinical narrative format suitable for formal medical records. Focus on:

1. Professional clinical language
2. Objective observations and assessments
3. Treatment progress and interventions
4. Specific, actionable recommendations
5. Integration of mood and behavioral data

${data.customPrompt ? `Additional instructions: ${data.customPrompt}` : ''}

Return response as JSON with:
- "generatedContent": Complete clinical narrative (flowing prose, no bullet points)
- "suggestions": Object with arrays of suggestions for each field`;

  const userPrompt = `Generate session notes for ${data.clientName || 'client'} from ${data.sessionType || 'therapy'} session on ${data.sessionDate || 'recent date'}.

Session Data:
- Session Focus: ${data.sessionFocus || 'Not specified'}
- Symptoms: ${data.symptoms || 'Not specified'}
- Goals: ${data.shortTermGoals || 'Not specified'}
- Interventions: ${data.intervention || 'Not specified'}
- Progress: ${data.progress || 'Not specified'}
- Clinical Remarks: ${data.remarks || 'Not specified'}
- Recommendations: ${data.recommendations || 'Not specified'}


Generate a professional clinical summary and provide smart suggestions for each category.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 2000,

    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    return result as AIGeneratedContent;
  } catch (error) {
    throw new Error(`AI content generation failed: ${error.message}`);
  }
}

export async function generateSmartSuggestions(field: string, context: string): Promise<string[]> {
  const systemPrompt = `You are a clinical psychology assistant. Generate 3-5 concise, professional suggestions for the ${field} field in therapy session notes. Focus on evidence-based practices and clinical terminology.`;

  const userPrompt = `Generate suggestions for "${field}" based on this context: ${context}

Return only a JSON array of strings, each suggestion should be 1-2 sentences maximum.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
      max_tokens: 500,

    });

    const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');
    return result.suggestions || [];
  } catch (error) {
    return [];
  }
}

// Assessment Report Generation
async function generateAssessmentReport(
  assignment: any, 
  responses: any[], 
  sections: any[]
): Promise<string> {
  // STRICT CLIENT DATA VALIDATION - Only include approved, sanitized fields
  // Prevents injection attacks and data leaks
  
  // Validate required fields
  if (!assignment || !assignment.client) {
    throw new Error("Assessment assignment and client data are required");
  }
  
  // Sanitize helper - strip HTML/scripts and trim whitespace
  const sanitize = (value: any): string => {
    if (!value) return 'Not provided';
    return String(value)
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim() || 'Not provided';
  };
  
  // Use EST timezone for all dates
  const PRACTICE_TIMEZONE = 'America/New_York';
  
  // Whitelist only approved client fields with strict sanitization
  const clientName = sanitize(assignment.client.fullName) || 'Client Name';
  const clientId = sanitize(assignment.client.clientId) || 'N/A';
  const dateOfBirth = assignment.client.dateOfBirth 
    ? formatInTimeZone(new Date(assignment.client.dateOfBirth), PRACTICE_TIMEZONE, 'MMM dd, yyyy') 
    : 'Not provided';
  const gender = sanitize(assignment.client.gender) || 'Not specified';
  const phone = sanitize(assignment.client.phoneNumber) || 'Not provided';
  const email = sanitize(assignment.client.emailAddress) || 'Not provided';
  
  // Build address from validated components only
  const addressParts = [
    sanitize(assignment.client.address),
    sanitize(assignment.client.city),
    sanitize(assignment.client.province),
    sanitize(assignment.client.postalCode)
  ].filter(part => part !== 'Not provided');
  const address = addressParts.length > 0 ? addressParts.join(', ') : 'Not provided';
  
  const assessmentName = sanitize(assignment.template?.name) || 'Assessment';
  const completedDate = assignment.completedAt 
    ? formatInTimeZone(new Date(assignment.completedAt), PRACTICE_TIMEZONE, 'MMM dd, yyyy') 
    : 'N/A';
  const clinicianName = sanitize(assignment.assignedBy?.fullName) || 'Clinician Name';
  const reportDate = formatInTimeZone(new Date(), PRACTICE_TIMEZONE, 'MMM dd, yyyy');
  
  const systemPrompt = `You are a licensed clinical psychologist generating a professional assessment report. Create a comprehensive clinical report using the assessment responses and section-specific prompts.

⚠️ CRITICAL SAFETY RULES:
1. USE the client data provided in bullet points (• Question → Answer format)
2. Transform this data into professional clinical narrative following the template format
3. If a specific answer says "Not provided" or is missing, write "information not available" in your narrative
4. Template examples in instructions (like "Dr. Sarah Thompson" or "123 Main Street") show the FORMAT only - replace them with actual client answers
5. NEVER invent details not present in the client's actual answers
6. This is real clinical documentation - use actual data provided, acknowledge gaps when data is missing

CRITICAL: Generate properly formatted HTML that will display correctly in a rich text editor.

HTML Formatting Requirements:
- Use <h2> tags for main section headings (no inline styles)
- Use <h3> tags for subsections (no inline styles)
- Wrap ALL narrative content in <p> tags - every sentence should be in a paragraph
- Add a blank line (<p><br></p>) between paragraphs for better readability
- Use <strong> tags for emphasis on key clinical terms
- DO NOT use <ul>, <li>, or bullet points - write everything as flowing narrative paragraphs
- Keep all HTML properly formatted and closed
- DO NOT use inline styles - they will be stripped by the editor

Clinical Content Requirements:
- Use professional clinical language appropriate for healthcare documentation
- Write in third-person narrative style (e.g., "The client reported..." or "Ms./Mr. [Name] indicated...")
- Transform raw responses into clinical observations and professional assessments
- CRITICAL: Follow each section's detailed template instructions EXACTLY
- The template shows you the exact format and structure - follow it precisely
- Create flowing narrative PARAGRAPHS ONLY - absolutely NO bullet points, NO lists, NO Q&A format
- Each section's template example shows the style - match that style exactly
- Include relevant clinical terminology and evidence-based observations
- Structure content logically within each section
- Synthesize information into coherent narrative paragraphs
- Break content into digestible paragraphs (3-5 sentences each)

For each section:
1. Start with an <h2> heading for the section title
2. Add a blank paragraph (<p><br></p>) after the heading
3. Read the section's template instructions and example output carefully
4. Transform client data into narrative paragraphs matching the template example format
5. Write ONLY in paragraph format using <p> tags - never use bullet points or lists
6. Separate paragraphs with blank lines (<p><br></p>) for readability
7. Use the template example as your guide for tone, structure, and level of detail
8. Create coherent, flowing clinical narrative paragraphs`;

  // Build client information header with validated fields only
  const clientInfo = `
Client Name: ${clientName}
Client ID: ${clientId}
Date of Birth: ${dateOfBirth}
Gender: ${gender}
Phone: ${phone}
Email: ${email}
Address: ${address}
Assessment: ${assessmentName}
Assessment Date: ${completedDate}
Clinician: ${clinicianName}
Report Generated: ${reportDate}
`;

  // Build the user prompt with client context (for personalization only, not for output)
  let userPrompt = `Generate a comprehensive clinical assessment report.

CONTEXT (for personalizing the narrative - DO NOT output this as a section):
Client: ${clientName}
Gender: ${gender}
Address: ${address}

CRITICAL RULES:
- DO NOT create a "CLIENT INFORMATION" section - this is shown separately in the UI
- Start immediately with the first assessment section below
- Use the client's actual name "${clientName}" when writing narratives (e.g., "Mr./Ms. ${clientName.split(' ').pop() || clientName}")
- Use appropriate pronouns for ${gender} client
- Output must be properly formatted HTML without inline styles
- Each section: <h2>SECTION NAME</h2> then <p><br></p> then content in <p> tags
- Add blank paragraphs (<p><br></p>) between content paragraphs for readability
- Transform responses into professional clinical narrative
- Use <strong> tags to emphasize key clinical terms

ASSESSMENT SECTIONS TO GENERATE:

`;

  // Add each section with its responses and AI prompt
  sections.forEach(section => {
    let sectionResponses = responses.filter(r => 
      section.questions?.some(q => Number(q.id) === Number(r.questionId))
    );

    // DEDUPLICATE: If multiple responders answered the same question, use only ONE response per question
    // Prefer the response with a score value, or the most recent one
    const uniqueResponses = new Map<number, any>();
    sectionResponses.forEach(resp => {
      const questionId = Number(resp.questionId);
      const existing = uniqueResponses.get(questionId);
      if (!existing) {
        uniqueResponses.set(questionId, resp);
      } else {
        // Prefer response with score value, or with actual data, or more recent
        const hasScore = resp.scoreValue !== null && resp.scoreValue !== undefined;
        const existingHasScore = existing.scoreValue !== null && existing.scoreValue !== undefined;
        const hasData = (resp.selectedOptions?.length > 0) || resp.responseText;
        const existingHasData = (existing.selectedOptions?.length > 0) || existing.responseText;
        
        if ((hasScore && !existingHasScore) || (hasData && !existingHasData)) {
          uniqueResponses.set(questionId, resp);
        }
      }
    });
    sectionResponses = Array.from(uniqueResponses.values());

    // DEBUG: Log section and response data
    console.log(`[AI DEBUG] Section: ${section.title}`);
    console.log(`[AI DEBUG] Section has ${section.questions?.length || 0} questions`);
    console.log(`[AI DEBUG] Found ${sectionResponses.length} unique responses for this section`);

    if (sectionResponses.length > 0) {
      userPrompt += `\n<h2>${section.title.toUpperCase()}</h2>\n<p><br></p>\n`;
      
      // Calculate section total score if this is a scoring section
      let sectionTotal = null;
      if (section.isScoring) {
        sectionTotal = sectionResponses.reduce((sum, resp) => {
          const scoreValue = resp.scoreValue ? Number(resp.scoreValue) : 0;
          return sum + scoreValue;
        }, 0);
      }
      
      if (section.aiReportPrompt) {
        userPrompt += `Section Template Instructions:\n${section.aiReportPrompt}\n\n`;
        userPrompt += `CRITICAL: The template above shows the EXACT format you should follow. Write flowing narrative paragraphs matching that example style. Do NOT use bullet points or lists.\n\n`;
        // Add section total score for scoring sections
        if (sectionTotal !== null) {
          userPrompt += `CRITICAL - USE EXACT SCORE: This section's total score is ${sectionTotal} out of ${sectionResponses.length * (section.questions?.[0]?.allOptions?.length ? section.questions[0].allOptions.length - 1 : 0)}. You MUST report this EXACT score - do not recalculate or interpret it.\n`;
          userPrompt += `Number of items: ${sectionResponses.length}\n\n`;
        }
      } else {
        // Default clinical section prompt based on section type
        const sectionTitle = section.title.toLowerCase();
        if (sectionTitle.includes('background') || sectionTitle.includes('history')) {
          userPrompt += `Instructions: Generate a comprehensive clinical background narrative for the "${section.title}" section. Focus on historical information, developmental factors, and contextual elements that inform the clinical picture. Use third-person clinical language appropriate for medical documentation.\n\n`;
        } else if (sectionTitle.includes('symptom') || sectionTitle.includes('present')) {
          userPrompt += `Instructions: Generate a detailed presentation of current symptoms and concerns for the "${section.title}" section. Focus on symptom severity, frequency, impact on functioning, and clinical observations. Use diagnostic criteria language where appropriate.\n\n`;
        } else if (sectionTitle.includes('mental status') || sectionTitle.includes('cognitive')) {
          userPrompt += `Instructions: Generate a formal mental status examination narrative for the "${section.title}" section. Include observations of appearance, behavior, mood, affect, thought process, thought content, perception, cognition, insight, and judgment as relevant to the responses.\n\n`;
        } else {
          userPrompt += `Instructions: Generate a professional clinical narrative for the "${section.title}" section using third-person language appropriate for clinical documentation. Focus on clinically relevant information and observations.\n\n`;
        }
      }

      userPrompt += `Client Data (use ALL details below to fill the template completely):\n\n`;
      
      console.log(`[AI DEBUG] Processing ${sectionResponses.length} responses for section "${section.title}"`);
      console.log(`[AI DEBUG] Section has ${section.questions?.length || 0} questions available`);
      
      sectionResponses.forEach((response, idx) => {
        console.log(`[AI DEBUG] Response ${idx + 1}: questionId=${response.questionId}`);
        const question = section.questions?.find(q => Number(q.id) === Number(response.questionId));
        
        if (!question) {
          console.log(`[AI DEBUG] WARNING: Question not found for questionId ${response.questionId}`);
          console.log(`[AI DEBUG] Available question IDs:`, section.questions?.map(q => q.id));
          return; // Skip this response
        }
        
        console.log(`[AI DEBUG] Found Q${question.id}: ${question.questionText}`);
        console.log(`[AI DEBUG] Response data:`, JSON.stringify(response, null, 2));
        
        // Extract answer text based on question type
        let answerText = '';
        
        if (question.questionType === 'short_text' || question.questionType === 'long_text') {
          answerText = response.responseText || 'Not provided';
        } else if (question.questionType === 'multiple_choice') {
          if (response.selectedOptions && Array.isArray(response.selectedOptions) && response.selectedOptions.length > 0) {
            const selectedTexts = response.selectedOptions
              .map(optionId => {
                const option = question.allOptions?.find((opt: any) => opt.id === Number(optionId));
                return option?.optionText;
              })
              .filter(Boolean);
            answerText = selectedTexts.length > 0 ? selectedTexts.join(', ') : 'Not selected';
          } else {
            answerText = response.responseText || 'Not selected';
          }
        } else if (question.questionType === 'checkbox') {
          if (response.selectedOptions && Array.isArray(response.selectedOptions) && response.selectedOptions.length > 0) {
            const selectedTexts = response.selectedOptions
              .map(optionId => {
                const option = question.allOptions?.find((opt: any) => opt.id === Number(optionId));
                return option?.optionText;
              })
              .filter(Boolean);
            answerText = selectedTexts.length > 0 ? selectedTexts.join('; ') : 'None selected';
          } else {
            answerText = response.responseText || 'None selected';
          }
        } else if (question.questionType === 'rating_scale' && response.ratingValue !== null && response.ratingValue !== undefined) {
          const rating = response.ratingValue;
          const minLabel = question.ratingLabels?.[0] || 'Low';
          const maxLabel = question.ratingLabels?.[1] || 'High';
          const min = question.ratingMin || 1;
          const max = question.ratingMax || 10;
          answerText = `${rating}/${max} (${minLabel} to ${maxLabel} scale)`;
        } else if (question.questionType === 'number' && response.responseValue !== null && response.responseValue !== undefined) {
          answerText = response.responseValue.toString();
        } else if (question.questionType === 'date' && response.responseText) {
          answerText = response.responseText;
        } else {
          answerText = response.responseText || 'Not provided';
        }
        
        // Format: Question → Answer (clear mapping for AI)
        // For scoring sections, include the score value so AI can group by severity
        if (section.isScoring && response.scoreValue !== null && response.scoreValue !== undefined) {
          const score = Number(response.scoreValue);
          let severityLabel = '';
          if (score === 0) severityLabel = 'Not endorsed';
          else if (score === 1) severityLabel = 'Mild';
          else if (score === 2) severityLabel = 'Moderate';
          else if (score >= 3) severityLabel = 'Severe';
          userPrompt += `• ${question.questionText}\n  → ${answerText} (Score: ${score} - ${severityLabel})\n\n`;
        } else {
          userPrompt += `• ${question.questionText}\n  → ${answerText}\n\n`;
        }
      });
      
      userPrompt += `\nREMINDER: Transform the answers above into professional narrative following the template format. Use the actual client answers - do not invent information not provided.\n\n`;
    }
  });

  // Add database-driven general report sections
  // Get general sections that have report mapping and AI prompts (can have questions or not)
  const generalSections = sections.filter(section => 
    section.reportMapping && 
    section.reportMapping !== 'none' &&
    section.aiReportPrompt
  );

  // Add general sections with their custom prompts
  generalSections.forEach(section => {
    userPrompt += `\n<h2>${section.title.toUpperCase()}</h2>\n<p><br></p>\n`;
    userPrompt += `Instructions: ${section.aiReportPrompt}\nWrap content in <p> tags and separate paragraphs with <p><br></p> for readability.\n\n`;
    
    // If section has questions, include them specifically
    if (section.questions && section.questions.length > 0) {
      userPrompt += `Section-Specific Data:\n`;
      section.questions.forEach(question => {
        const response = responses.find(r => r.questionId === question.id);
        if (response) {
          userPrompt += `Q: ${question.questionText}\nA: `;
          
          // Handle different response types properly (matching regular sections logic)
          if (question.questionType === 'short_text' || question.questionType === 'long_text') {
            userPrompt += response.responseText || 'No response provided';
          } else if (question.questionType === 'multiple_choice') {
            if (response.selectedOptions && Array.isArray(response.selectedOptions) && response.selectedOptions.length > 0) {
              // selectedOptions contains OPTION IDs, need to map to option texts
              const selectedTexts = response.selectedOptions
                .map(optionId => {
                  const option = question.allOptions?.find((opt: any) => opt.id === Number(optionId));
                  return option?.optionText;
                })
                .filter(Boolean);
              userPrompt += selectedTexts.length > 0 ? selectedTexts.join(', ') : 'No selection made';
            } else if (response.responseText) {
              userPrompt += response.responseText;
            } else {
              userPrompt += 'No selection made';
            }
          } else if (question.questionType === 'checkbox') {
            if (response.selectedOptions && Array.isArray(response.selectedOptions) && response.selectedOptions.length > 0) {
              // selectedOptions contains OPTION IDs, need to map to option texts
              const selectedTexts = response.selectedOptions
                .map(optionId => {
                  const option = question.allOptions?.find((opt: any) => opt.id === Number(optionId));
                  return option?.optionText;
                })
                .filter(Boolean);
              userPrompt += selectedTexts.length > 0 ? selectedTexts.join(', ') : 'No selections made';
            } else if (response.responseText) {
              userPrompt += response.responseText;
            } else {
              userPrompt += 'No selections made';
            }
          } else if (question.questionType === 'rating_scale' && response.ratingValue !== null && response.ratingValue !== undefined) {
            const rating = response.ratingValue;
            const minLabel = question.ratingLabels?.[0] || 'Low';
            const maxLabel = question.ratingLabels?.[1] || 'High';
            const min = question.ratingMin || 1;
            const max = question.ratingMax || 10;
            userPrompt += `${rating}/${max} (${minLabel} to ${maxLabel} scale)`;
          } else if (question.questionType === 'date' && response.responseText) {
            userPrompt += response.responseText;
          } else {
            userPrompt += response.responseText || 'No response provided';
          }
          userPrompt += '\n\n';
        }
      });
    }
    
    userPrompt += `Assessment Synthesis: Analyze and synthesize ALL assessment responses and findings provided above to generate this section according to the instructions.\n\n`;
  });

  // If no general sections configured, add default clinical sections
  if (generalSections.length === 0) {
    userPrompt += `

<h2>CLINICAL SUMMARY</h2>
<p><br></p>

Instructions: Generate a comprehensive clinical summary that synthesizes all assessment findings. Include:
- Overall clinical presentation and diagnostic impressions
- Key symptoms and their severity/impact
- Risk factors and protective factors
- Functional impairments and strengths
- Clinical observations and professional judgment
Use third-person clinical language suitable for diagnostic and treatment planning purposes.
Wrap all narrative content in <p> tags. Separate paragraphs with <p><br></p> for better readability.

Client Response Data: Use all the assessment responses provided above to synthesize this summary.

<h2>INTERVENTION PLAN AND RECOMMENDATIONS</h2>
<p><br></p>

Instructions: Generate evidence-based treatment recommendations and intervention planning based on the assessment findings. Include:
- Recommended treatment modalities and therapeutic approaches
- Specific intervention targets and goals
- Referral recommendations if appropriate
- Risk management strategies if indicated
- Timeline and frequency recommendations
- Client strengths that can support treatment
Use professional clinical language appropriate for treatment planning documentation.
Wrap all narrative content in <p> tags. Separate paragraphs with <p><br></p> for better readability.

Client Response Data: Base recommendations on the assessment findings and clinical summary above.
`;
  }

  try {
    // Validate API key is present before making the request
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY && !process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key is not configured. Please set OPENAI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY environment variable.");
    }

    console.log('[AI] Starting assessment report generation...');
    console.log('[AI DEBUG] ==== DATA BEING SENT TO AI ====');
    console.log('[AI DEBUG] Prompt length:', userPrompt.length, 'characters');
    console.log('[AI DEBUG] First section with data (chars 2000-4000):');
    console.log(userPrompt.substring(2000, 4000));
    console.log('[AI DEBUG] ================================');
    
    const startTime = Date.now();
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0,
      max_tokens: 4000,
    });

    const duration = Date.now() - startTime;
    console.log(`[AI] Assessment report generation completed in ${duration}ms`);

    let content = response.choices[0].message.content || '';
    
    if (!content) {
      throw new Error("OpenAI returned empty content. Please check your API key and try again.");
    }
    
    // Strip markdown code fences if AI wrapped the response in them
    // Remove opening code fence (```html or ```)
    content = content.replace(/^```(?:html)?\s*\n/i, '');
    // Remove closing code fence
    content = content.replace(/\n```\s*$/i, '');
    // Remove any stray code fence markers in the middle
    content = content.replace(/```(?:html)?\s*/gi, '');
    
    return content.trim();
  } catch (error: any) {
    console.error('[AI] Assessment report generation error:', error);
    if (error.code === 'insufficient_quota') {
      throw new Error("OpenAI API quota exceeded. Please check your API billing.");
    } else if (error.code === 'invalid_api_key') {
      throw new Error("Invalid OpenAI API key. Please check your OPENAI_API_KEY configuration.");
    } else if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      throw new Error("OpenAI API request timed out. Please try again.");
    } else if (error.message) {
      throw new Error(`Assessment report generation failed: ${error.message}`);
    } else {
      throw new Error(`Assessment report generation failed: ${JSON.stringify(error)}`);
    }
  }
}

export async function generateClinicalReport(sessionNoteData: any): Promise<string> {
  const systemPrompt = `You are a licensed clinical psychologist. Generate a formal, professional clinical report in third-person narrative format. Use flowing prose suitable for official medical records, insurance documentation, and clinical case files.

Key requirements:
- Third-person clinical language
- Professional medical terminology
- Objective observations and assessments
- No bullet points or lists
- Flowing paragraph structure
- Evidence-based treatment approach references`;

  const userPrompt = `Generate a formal clinical report based on this session data:

Client Information: ${sessionNoteData.clientName || 'Client'}
Session Type: ${sessionNoteData.sessionType || 'Individual therapy'}
Date: ${sessionNoteData.sessionDate || 'Session date'}

Clinical Data:
${sessionNoteData.sessionFocus ? `Session Focus: ${sessionNoteData.sessionFocus}` : ''}
${sessionNoteData.symptoms ? `Presented Symptoms: ${sessionNoteData.symptoms}` : ''}
${sessionNoteData.shortTermGoals ? `Treatment Goals: ${sessionNoteData.shortTermGoals}` : ''}
${sessionNoteData.intervention ? `Interventions Applied: ${sessionNoteData.intervention}` : ''}
${sessionNoteData.progress ? `Progress Assessment: ${sessionNoteData.progress}` : ''}
${sessionNoteData.remarks ? `Clinical Observations: ${sessionNoteData.remarks}` : ''}
${sessionNoteData.recommendations ? `Treatment Recommendations: ${sessionNoteData.recommendations}` : ''}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.6,
      max_tokens: 1500,

    });

    return response.choices[0].message.content || '';
  } catch (error) {
    throw new Error(`Clinical report generation failed: ${error.message}`);
  }
}

// Voice Transcription and Mapping for Session Notes
interface TranscriptionResult {
  rawTranscription: string;
  mappedFields: {
    sessionFocus?: string;
    symptoms?: string;
    shortTermGoals?: string;
    intervention?: string;
    progress?: string;
    remarks?: string;
    recommendations?: string;
  };
}

export async function transcribeAndMapAudio(
  audioBuffer: Buffer,
  fileName: string,
  clientName?: string,
  sessionDate?: string
): Promise<TranscriptionResult> {
  try {
    console.log('[AI] Starting voice transcription...');
    const startTime = Date.now();

    // Step 1: Transcribe audio using OpenAI Whisper (direct API, not proxy)
    const whisper = getWhisperClient();
    
    // Create a File-like object for the OpenAI SDK (Node.js doesn't have File constructor)
    const audioFile = await OpenAI.toFile(audioBuffer, fileName, {
      type: 'audio/webm'
    });
    
    const transcription = await whisper.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en', // Can be auto-detected by removing this
      response_format: 'text'
    });

    const rawTranscription = transcription as unknown as string;
    const transcriptionDuration = Date.now() - startTime;
    console.log(`[AI] Transcription completed in ${transcriptionDuration}ms. Length: ${rawTranscription.length} chars`);

    // Step 2: Map transcription to session note fields using GPT
    console.log('[AI] Mapping transcription to session note fields...');
    const mappingStartTime = Date.now();

    const systemPrompt = `You are a professional clinical therapist AI assistant specializing in structuring voice-recorded session notes into formal documentation.

Your task is to analyze the voice transcription of a therapy session and extract/structure it into specific clinical documentation fields.`;

    const userPrompt = `VOICE TRANSCRIPTION FROM THERAPY SESSION:
${clientName ? `Client: ${clientName}` : ''}
${sessionDate ? `Session Date: ${sessionDate}` : ''}

TRANSCRIPT:
${rawTranscription}

---

Please analyze this transcription and structure it into the following clinical documentation fields. Extract relevant information from the transcript and present it in professional clinical language:

1. SESSION FOCUS: Main topics/goals addressed in the session (2-3 sentences)
2. SYMPTOMS: Client's reported symptoms, concerns, or presenting issues
3. SHORT-TERM GOALS: Specific goals discussed or identified for the client
4. INTERVENTION: Therapeutic techniques, interventions, or approaches used
5. PROGRESS: Client's progress, insights gained, or improvements noted
6. REMARKS: Additional clinical observations or noteworthy points
7. RECOMMENDATIONS: Follow-up actions, homework, or recommendations for next session

IMPORTANT RULES:
- Use professional clinical language (third-person perspective preferred)
- Be concise but comprehensive
- If a field has no relevant information from the transcript, write "Not addressed in this session"
- Focus on clinically relevant information
- Maintain confidentiality and professional tone
- Do not invent information not present in the transcript

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:
SESSION FOCUS: [your text here]

SYMPTOMS: [your text here]

SHORT-TERM GOALS: [your text here]

INTERVENTION: [your text here]

PROGRESS: [your text here]

REMARKS: [your text here]

RECOMMENDATIONS: [your text here]`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Low temperature for consistent extraction
      max_tokens: 2000
    });

    const mappedContent = response.choices[0].message.content || '';
    const mappingDuration = Date.now() - mappingStartTime;
    console.log(`[AI] Mapping completed in ${mappingDuration}ms`);

    // Step 3: Parse the structured response
    const mappedFields: TranscriptionResult['mappedFields'] = {};
    
    const extractField = (label: string): string | undefined => {
      const regex = new RegExp(`${label}:\\s*(.+?)(?=\\n\\n[A-Z]|$)`, 's');
      const match = mappedContent.match(regex);
      if (match && match[1]) {
        const value = match[1].trim();
        return value !== 'Not addressed in this session' ? value : undefined;
      }
      return undefined;
    };

    mappedFields.sessionFocus = extractField('SESSION FOCUS');
    mappedFields.symptoms = extractField('SYMPTOMS');
    mappedFields.shortTermGoals = extractField('SHORT-TERM GOALS');
    mappedFields.intervention = extractField('INTERVENTION');
    mappedFields.progress = extractField('PROGRESS');
    mappedFields.remarks = extractField('REMARKS');
    mappedFields.recommendations = extractField('RECOMMENDATIONS');

    const totalDuration = Date.now() - startTime;
    console.log(`[AI] Complete transcription + mapping in ${totalDuration}ms`);

    return {
      rawTranscription,
      mappedFields
    };
  } catch (error: any) {
    console.error('[AI] Voice transcription error:', error);
    throw new Error(`Voice transcription failed: ${error.message || 'Unknown error'}`);
  }
}

// Generate content using connected templates
export async function generateFromTemplate(templateId: string, field: string, context?: string): Promise<string> {
  const template = clinicalTemplates[templateId];
  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

  // Use the template system to get the appropriate content
  const fieldOptionsKey = `${field}Options`;
  const fieldOptions = template[fieldOptionsKey];
  
  if (!fieldOptions) {
    throw new Error(`Template field ${field} not found in ${templateId}`);
  }

  // For now, return the first available option template
  // This could be enhanced to use AI to select the most appropriate option
  const firstOption = Object.values(fieldOptions)[0];
  return firstOption?.template || `${field} content for ${template.name}`;
}

// Get connected content suggestions based on current field value
export async function getConnectedSuggestions(templateId: string, sourceField: string, sourceValue: string): Promise<{[key: string]: string[]}> {
  const template = clinicalTemplates[templateId];
  if (!template) {
    return {};
  }

  const sourceOptionsKey = `${sourceField}Options`;
  const sourceOptions = template[sourceOptionsKey];
  
  if (!sourceOptions) {
    return {};
  }

  // Find matching option based on sourceValue
  const matchingOption = Object.values(sourceOptions).find((option: any) => 
    option.label.toLowerCase().includes(sourceValue.toLowerCase()) || 
    option.template.toLowerCase().includes(sourceValue.toLowerCase())
  );

  if (!matchingOption?.connects) {
    return {};
  }

  // Build suggestions for connected fields
  const suggestions: {[key: string]: string[]} = {};
  
  for (const [targetField, optionKey] of Object.entries(matchingOption.connects)) {
    const targetOptionsKey = `${targetField}Options`;
    const targetOptions = template[targetOptionsKey];
    
    if (targetOptions && targetOptions[optionKey]) {
      suggestions[targetField] = [targetOptions[optionKey].template];
    }
  }

  return suggestions;
}

// Get all options for a specific field in a template
export function getFieldOptions(templateId: string, field: string): Array<{key: string, label: string, template: string}> {
  const template = clinicalTemplates[templateId];
  if (!template) {
    return [];
  }

  const fieldOptionsKey = `${field}Options`;
  const fieldOptions = template[fieldOptionsKey];
  
  if (!fieldOptions) {
    return [];
  }

  return Object.entries(fieldOptions).map(([key, option]: [string, any]) => ({
    key,
    label: option.label,
    template: option.template
  }));
}

// Get all available templates
export function getAllTemplates() {
  return clinicalTemplates;
}

// Voice Transcription for Assessment Text Fields
export async function transcribeAssessmentAudio(
  audioBuffer: Buffer,
  fileName: string,
  translateToEnglish: boolean = false
): Promise<string> {
  try {
    console.log('[AI] Starting assessment audio transcription...');
    const startTime = Date.now();

    const whisper = getWhisperClient();
    
    // Create a File-like object for the OpenAI SDK
    const audioFile = await OpenAI.toFile(audioBuffer, fileName, {
      type: 'audio/webm'
    });
    
    // Transcribe audio
    const transcription = await whisper.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      response_format: 'text'
    });

    let result = transcription as unknown as string;
    const transcriptionDuration = Date.now() - startTime;
    console.log(`[AI] Assessment transcription completed in ${transcriptionDuration}ms. Length: ${result.length} chars`);

    // Optional: Translate to English
    if (translateToEnglish) {
      console.log('[AI] Translating to English...');
      const translationStartTime = Date.now();
      
      const translationResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'system', 
            content: 'You are a professional translator. Translate the following text to English. If it is already in English, return it as-is. Preserve the meaning and tone accurately.' 
          },
          { 
            role: 'user', 
            content: result 
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      result = translationResponse.choices[0].message.content || result;
      const translationDuration = Date.now() - translationStartTime;
      console.log(`[AI] Translation completed in ${translationDuration}ms`);
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[AI] Assessment transcription complete in ${totalDuration}ms`);

    return result;
  } catch (error: any) {
    console.error('[AI] Assessment transcription error:', error);
    throw new Error(`Voice transcription failed: ${error.message || 'Unknown error'}`);
  }
}

// Export the assessment report generation function
export { generateAssessmentReport };


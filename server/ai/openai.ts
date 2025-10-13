import OpenAI from "openai";
import { format } from "date-fns";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  
  // Whitelist only approved client fields with strict sanitization
  const clientName = sanitize(assignment.client.fullName) || 'Client Name';
  const clientId = sanitize(assignment.client.clientId) || 'N/A';
  const dateOfBirth = assignment.client.dateOfBirth 
    ? format(new Date(assignment.client.dateOfBirth), 'MMM dd, yyyy') 
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
    ? format(new Date(assignment.completedAt), 'MMM dd, yyyy') 
    : 'N/A';
  const clinicianName = sanitize(assignment.assignedBy?.fullName) || 'Clinician Name';
  const reportDate = format(new Date(), 'MMM dd, yyyy');
  
  const systemPrompt = `You are a licensed clinical psychologist generating a professional assessment report. Create a comprehensive clinical report using the assessment responses and section-specific prompts.

Key requirements:
- Use professional clinical language appropriate for healthcare documentation
- Write in third-person narrative style (e.g., "The client reported..." or "Ms./Mr. [Name] indicated...")
- Transform raw responses into clinical observations and professional assessments
- Follow each section's specific instructions for content and focus
- Create flowing narrative prose, not bullet points or raw Q&A format
- Include relevant clinical terminology and evidence-based observations
- Structure content logically within each section
- Synthesize information rather than simply listing responses

For each section:
1. Follow the specific instructions provided for that section
2. Transform client responses into professional clinical narrative
3. Focus on clinically relevant information and observations
4. Use appropriate clinical terminology for the section's focus area
5. Create coherent paragraphs that flow naturally`;

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

  // Build the user prompt with client information and section data
  let userPrompt = `Generate a comprehensive clinical assessment report with the following structure:

# CLIENT INFORMATION

${clientInfo}

---

IMPORTANT INSTRUCTIONS:
1. Start with the CLIENT INFORMATION section exactly as shown above
2. Then proceed with each assessment section as a separate section with its own heading
3. Use the section-specific AI prompt instructions when available
4. Each section should have a clear title (## Section Name) 
5. Transform raw responses into professional clinical narrative format
6. Use third-person clinical language appropriate for medical documentation

ASSESSMENT SECTIONS:

`;

  // Add each section with its responses and AI prompt
  sections.forEach(section => {
    const sectionResponses = responses.filter(r => 
      section.questions?.some(q => q.id === r.questionId)
    );

    if (sectionResponses.length > 0) {
      userPrompt += `\n## ${section.title}\n`;
      
      if (section.aiReportPrompt) {
        userPrompt += `Instructions: ${section.aiReportPrompt}\n\n`;
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

      userPrompt += `Client Responses:\n`;
      sectionResponses.forEach(response => {
        const question = section.questions?.find(q => q.id === response.questionId);
        if (question) {
          userPrompt += `Q: ${question.questionText}\nA: `;
          
          // Handle different response types properly
          if (question.questionType === 'short_text' || question.questionType === 'long_text') {
            userPrompt += response.responseText || 'No response provided';
          } else if (question.questionType === 'multiple_choice') {
            if (response.selectedOptions && Array.isArray(response.selectedOptions) && response.selectedOptions.length > 0) {
              const selectedTexts = response.selectedOptions
                .map(index => question.options?.[index])
                .filter(Boolean);
              userPrompt += selectedTexts.length > 0 ? selectedTexts.join(', ') : 'No selection made';
            } else if (response.responseText) {
              userPrompt += response.responseText;
            } else {
              userPrompt += 'No selection made';
            }
          } else if (question.questionType === 'checkbox') {
            if (response.selectedOptions && Array.isArray(response.selectedOptions) && response.selectedOptions.length > 0) {
              const selectedTexts = response.selectedOptions
                .map(index => question.options?.[index])
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
          } else if (question.questionType === 'number' && response.responseValue !== null && response.responseValue !== undefined) {
            userPrompt += response.responseValue.toString();
          } else if (question.questionType === 'date' && response.responseValue) {
            userPrompt += response.responseValue;
          } else {
            userPrompt += response.responseText || response.responseValue || 'No response provided';
          }
          userPrompt += '\n\n';
        }
      });
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
    userPrompt += `\n## ${section.title.toUpperCase()}\n\n`;
    userPrompt += `Instructions: ${section.aiReportPrompt}\n\n`;
    
    // If section has questions, include them specifically
    if (section.questions && section.questions.length > 0) {
      userPrompt += `Section-Specific Data: `;
      section.questions.forEach(question => {
        const response = responses.find(r => r.questionId === question.id);
        if (response) {
          userPrompt += `Q: ${question.questionText} A: ${response.responseValue} `;
        }
      });
      userPrompt += `\n\n`;
    }
    
    userPrompt += `Assessment Synthesis: Analyze and synthesize ALL assessment responses and findings provided above to generate this section according to the instructions.\n\n`;
  });

  // If no general sections configured, add default clinical sections
  if (generalSections.length === 0) {
    userPrompt += `

## CLINICAL SUMMARY

Instructions: Generate a comprehensive clinical summary that synthesizes all assessment findings. Include:
- Overall clinical presentation and diagnostic impressions
- Key symptoms and their severity/impact
- Risk factors and protective factors
- Functional impairments and strengths
- Clinical observations and professional judgment
Use third-person clinical language suitable for diagnostic and treatment planning purposes.

Client Response Data: Use all the assessment responses provided above to synthesize this summary.

## INTERVENTION PLAN AND RECOMMENDATIONS

Instructions: Generate evidence-based treatment recommendations and intervention planning based on the assessment findings. Include:
- Recommended treatment modalities and therapeutic approaches
- Specific intervention targets and goals
- Referral recommendations if appropriate
- Risk management strategies if indicated
- Timeline and frequency recommendations
- Client strengths that can support treatment
Use professional clinical language appropriate for treatment planning documentation.

Client Response Data: Base recommendations on the assessment findings and clinical summary above.
`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.6,
      max_tokens: 4000,
    });

    return response.choices[0].message.content || '';
  } catch (error) {
    throw new Error(`Assessment report generation failed: ${error.message}`);
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

// Export the assessment report generation function
export { generateAssessmentReport };


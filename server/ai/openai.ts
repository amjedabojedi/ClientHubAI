import OpenAI from "openai";

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
  moodBefore?: number;
  moodAfter?: number;
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
- Date: ${sessionData?.sessionDate ? new Date(sessionData.sessionDate).toLocaleDateString() : 'Not specified'}
- Type: ${sessionData?.sessionType || 'Not specified'}
- Duration: ${sessionData?.duration || 'Not specified'} minutes

EXISTING FORM DATA:
- Session Focus: ${formData?.sessionFocus || 'Not filled'}
- Symptoms: ${formData?.symptoms || 'Not filled'}
- Short-term Goals: ${formData?.shortTermGoals || 'Not filled'}
- Interventions: ${formData?.intervention || 'Not filled'}
- Progress: ${formData?.progress || 'Not filled'}
- Mood Before: ${formData?.moodBefore || 'Not rated'}/10
- Mood After: ${formData?.moodAfter || 'Not rated'}/10
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

Generate a complete session note template that can be used directly for clinical documentation. Format it as a structured clinical note.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are a professional clinical therapist AI assistant. Generate comprehensive, professional session note templates based on the provided information and custom instructions."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });

    const generatedContent = response.choices[0].message.content || "Failed to generate content";

    return {
      generatedContent
    };
  } catch (error) {
    console.error("Error generating AI template:", error);
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
- Mood Before (1-10): ${data.moodBefore || 'Not rated'}
- Mood After (1-10): ${data.moodAfter || 'Not rated'}

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
    console.error('AI generation error:', error);
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
    console.error('Smart suggestions error:', error);
    return [];
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
${sessionNoteData.moodBefore && sessionNoteData.moodAfter ? `Mood Assessment: Before ${sessionNoteData.moodBefore}/10, After ${sessionNoteData.moodAfter}/10` : ''}`;

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
    console.error('Clinical report generation error:', error);
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
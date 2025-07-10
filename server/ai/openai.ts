import OpenAI from "openai";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Clinical Note Templates
export const clinicalTemplates = {
  'cognitive_behavioral': {
    name: 'Cognitive Behavioral Therapy (CBT)',
    description: 'Focus on thought patterns, cognitive restructuring, and behavioral interventions',
    sessionFocusTemplate: 'Explored cognitive patterns related to [presenting concern]. Identified negative thought cycles and worked on cognitive restructuring techniques.',
    symptomsTemplate: 'Client presented with [specific symptoms]. Noted [behavioral/emotional indicators]. Assessed cognitive distortions including [types].',
    interventionTemplate: 'Applied CBT techniques including [specific interventions]. Practiced thought challenging and behavioral activation strategies.',
    progressTemplate: 'Client demonstrated improved awareness of [cognitive patterns]. Progress toward goals shows [specific improvements].',
    recommendationsTemplate: 'Continue CBT approach focusing on [specific areas]. Homework: [specific assignments]. Next session focus: [topics].'
  },
  'trauma_focused': {
    name: 'Trauma-Focused Therapy',
    description: 'Specialized approach for trauma processing and PTSD treatment',
    sessionFocusTemplate: 'Addressed trauma-related triggers and coping mechanisms. Focused on safety, stabilization, and processing.',
    symptomsTemplate: 'Trauma symptoms included [specific presentations]. Assessed for hypervigilance, dissociation, and avoidance behaviors.',
    interventionTemplate: 'Utilized trauma-informed interventions including [EMDR/CPT/PE]. Implemented grounding and stabilization techniques.',
    progressTemplate: 'Client shows decreased trauma reactivity in [areas]. Improved coping strategies for [triggers].',
    recommendationsTemplate: 'Continue trauma-focused work with emphasis on [phase of treatment]. Safety planning and coping skill reinforcement.'
  },
  'mindfulness_based': {
    name: 'Mindfulness-Based Therapy',
    description: 'Integration of mindfulness practices with therapeutic interventions',
    sessionFocusTemplate: 'Practiced mindfulness techniques and present-moment awareness. Explored relationship between thoughts, emotions, and sensations.',
    symptomsTemplate: 'Client reported [emotional/physical symptoms]. Noted patterns of rumination, anxiety, or emotional dysregulation.',
    interventionTemplate: 'Guided mindfulness meditation and body awareness exercises. Taught [specific mindfulness techniques].',
    progressTemplate: 'Increased mindfulness skills and emotional regulation. Client reports better ability to [specific improvements].',
    recommendationsTemplate: 'Continue daily mindfulness practice. Home practice: [specific exercises]. Integration of mindfulness in daily activities.'
  },
  'solution_focused': {
    name: 'Solution-Focused Brief Therapy',
    description: 'Goal-oriented approach focusing on solutions and client strengths',
    sessionFocusTemplate: 'Explored client strengths and previous successful coping strategies. Identified solution-focused goals and desired outcomes.',
    symptomsTemplate: 'Client described [challenges] while acknowledging [existing strengths and resources].',
    interventionTemplate: 'Used scaling questions, miracle question, and exception-finding techniques. Highlighted client competencies.',
    progressTemplate: 'Client identified [specific solutions] and demonstrated [strengths]. Movement toward preferred future noted.',
    recommendationsTemplate: 'Build on identified solutions and strengths. Focus on [specific goals]. Continue solution-building approach.'
  },
  'psychodynamic': {
    name: 'Psychodynamic Therapy',
    description: 'Insight-oriented exploration of unconscious patterns and relationships',
    sessionFocusTemplate: 'Explored unconscious patterns and their impact on current relationships. Examined transference and defense mechanisms.',
    symptomsTemplate: 'Client presented with [symptoms] connected to [underlying dynamics]. Noted defense mechanisms and relational patterns.',
    interventionTemplate: 'Used interpretation, clarification, and insight-oriented interventions. Explored childhood experiences and their current impact.',
    progressTemplate: 'Increased insight into [patterns/relationships]. Client demonstrates greater self-awareness regarding [areas].',
    recommendationsTemplate: 'Continue insight-oriented work. Focus on [specific dynamics]. Process emerging material in next sessions.'
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

// Generate content using templates
export async function generateFromTemplate(templateId: string, field: string, context?: string): Promise<string> {
  const template = clinicalTemplates[templateId];
  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }

  const fieldTemplateKey = `${field}Template`;
  const baseTemplate = template[fieldTemplateKey];
  
  if (!baseTemplate) {
    throw new Error(`Template field ${field} not found in ${templateId}`);
  }

  const systemPrompt = `You are a clinical psychology assistant specializing in ${template.name}. Generate professional clinical content based on the provided template and context. Fill in the placeholder brackets with appropriate content based on the context provided.

Template approach: ${template.description}
Base template: ${baseTemplate}

Instructions:
- Replace bracketed placeholders with specific, relevant content
- Maintain professional clinical language
- Keep the structure and tone of the template
- Adapt content to the specific context provided`;

  const userPrompt = `Generate ${field} content using the ${template.name} template.
${context ? `Context: ${context}` : 'No additional context provided'}

Base template: ${baseTemplate}

Return only the completed text with placeholders filled in appropriately.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    return response.choices[0].message.content || baseTemplate;
  } catch (error) {
    console.error('Template generation error:', error);
    return baseTemplate; // Return base template as fallback
  }
}

// Get all available templates
export function getAllTemplates() {
  return clinicalTemplates;
}
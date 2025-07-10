import OpenAI from "openai";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
      timeout: 30000 // 30 second timeout
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
      timeout: 15000 // 15 second timeout
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
      timeout: 30000
    });

    return response.choices[0].message.content || '';
  } catch (error) {
    console.error('Clinical report generation error:', error);
    throw new Error(`Clinical report generation failed: ${error.message}`);
  }
}
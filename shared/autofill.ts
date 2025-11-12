/**
 * Shared autofill variable utilities for clinical forms
 * Centralizes variable mapping to prevent drift between client portal and PDF generation
 */

export interface AutofillData {
  client?: {
    fullName?: string;
    clientId?: string;
    email?: string;
    phone?: string;
    dateOfBirth?: string;
  };
  therapist?: {
    fullName?: string;
    email?: string;
    phone?: string;
  };
  practice?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
}

/**
 * Builds a map of all available autofill variables
 */
export function buildAutofillMap(data: AutofillData): Record<string, string> {
  return {
    // Client variables
    'CLIENT_NAME': data.client?.fullName || '',
    'CLIENT_FULL_NAME': data.client?.fullName || '',
    'CLIENT_ID': data.client?.clientId || '',
    'CLIENT_EMAIL': data.client?.email || '',
    'CLIENT_PHONE': data.client?.phone || '',
    'CLIENT_DOB': data.client?.dateOfBirth || '',
    
    // Therapist variables
    'THERAPIST_NAME': data.therapist?.fullName || '',
    'THERAPIST_FULL_NAME': data.therapist?.fullName || '',
    'THERAPIST_EMAIL': data.therapist?.email || '',
    'THERAPIST_PHONE': data.therapist?.phone || '',
    
    // Practice variables
    'PRACTICE_NAME': data.practice?.name || '',
    'PRACTICE_ADDRESS': data.practice?.address || '',
    'PRACTICE_PHONE': data.practice?.phone || '',
    'PRACTICE_EMAIL': data.practice?.email || '',
    'PRACTICE_WEBSITE': data.practice?.website || '',
  };
}

/**
 * Returns list of all available autofill variables with descriptions
 */
export function getAvailableAutofillVariables(): Array<{ variable: string; description: string; category: string }> {
  return [
    // Client Information
    { variable: '{{CLIENT_NAME}}', description: 'Client full name', category: 'Client Information' },
    { variable: '{{CLIENT_FULL_NAME}}', description: 'Client full name (same as CLIENT_NAME)', category: 'Client Information' },
    { variable: '{{CLIENT_ID}}', description: 'Client ID number', category: 'Client Information' },
    { variable: '{{CLIENT_EMAIL}}', description: 'Client email address', category: 'Client Information' },
    { variable: '{{CLIENT_PHONE}}', description: 'Client phone number', category: 'Client Information' },
    { variable: '{{CLIENT_DOB}}', description: 'Client date of birth', category: 'Client Information' },
    
    // Therapist Information
    { variable: '{{THERAPIST_NAME}}', description: 'Therapist full name', category: 'Therapist Information' },
    { variable: '{{THERAPIST_FULL_NAME}}', description: 'Therapist full name (same as THERAPIST_NAME)', category: 'Therapist Information' },
    { variable: '{{THERAPIST_EMAIL}}', description: 'Therapist email address', category: 'Therapist Information' },
    { variable: '{{THERAPIST_PHONE}}', description: 'Therapist phone number', category: 'Therapist Information' },
    
    // Practice Information
    { variable: '{{PRACTICE_NAME}}', description: 'Practice/clinic name', category: 'Practice Information' },
    { variable: '{{PRACTICE_ADDRESS}}', description: 'Practice full address', category: 'Practice Information' },
    { variable: '{{PRACTICE_PHONE}}', description: 'Practice phone number', category: 'Practice Information' },
    { variable: '{{PRACTICE_EMAIL}}', description: 'Practice email address', category: 'Practice Information' },
    { variable: '{{PRACTICE_WEBSITE}}', description: 'Practice website URL', category: 'Practice Information' },
  ];
}

/**
 * Replaces autofill variables in a template string
 */
export function replaceAutofillVariables(
  template: string,
  autofillMap: Record<string, string>,
  escapeHtml: (str: string) => string = (s) => s
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, placeholder) => {
    const trimmed = placeholder.trim();
    const value = autofillMap[trimmed];
    if (value) {
      return escapeHtml(value);
    }
    return match; // Keep original if no value found
  });
}

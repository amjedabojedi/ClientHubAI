/**
 * Shared utility module for assessment response formatting
 * Consolidates question lookup and display-string generation logic
 * used by both assessment-completion and assessment-report pages.
 */

export interface OptionLookup {
  byId: Map<number, string>;
  byIndex: Map<number, string>;
}

export interface ResponseDisplayResult {
  primaryText: string;
  secondaryText?: string;
  missingOptionIds?: number[];
}

/**
 * Legacy fallback options for known assessment templates (e.g., BDI-II)
 * Used only when question lacks both allOptions and options (legacy data)
 */
function getLegacyQuestionOptions(questionText: string): string[] | null {
  const text = questionText?.toLowerCase() || '';
  
  // BDI-II question patterns
  if (text.includes('sadness')) {
    return ['I do not feel sad.', 'I feel sad much of the time.', 'I am sad all the time.', "I am so sad or unhappy that I can't stand it."];
  }
  if (text.includes('pessimism')) {
    return ['I am not discouraged about my future.', 'I feel more discouraged about my future than I used to be.', 'I do not expect things to work out for me.', 'I feel my future is hopeless and will only get worse.'];
  }
  if (text.includes('past failure')) {
    return ['I do not feel like a failure.', 'I have failed more than I should have.', 'As I look back, I see a lot of failures.', 'I feel I am a total failure as a person.'];
  }
  if (text.includes('loss of pleasure')) {
    return ['I get as much pleasure as I ever did from the things I enjoy.', "I don't enjoy things as much as I used to.", 'I get very little pleasure from the things I used to enjoy.', "I can't get any pleasure from the things I used to enjoy."];
  }
  if (text.includes('guilty feelings')) {
    return ["I don't feel particularly guilty.", 'I feel guilty over many things I have done or should have done.', 'I feel quite guilty most of the time.', 'I feel guilty all of the time.'];
  }
  if (text.includes('session format')) {
    return ['In-Person', 'Online', 'Phone'];
  }
  
  // Default fallback
  return ['Yes', 'No'];
}

/**
 * Creates lookup maps for efficient option ID/index to text conversion
 * Handles both modern allOptions (with IDs) and legacy options (array-based)
 */
export function createOptionLookup(question: any): OptionLookup {
  const byId = new Map<number, string>();
  const byIndex = new Map<number, string>();

  // Modern approach: Use allOptions with database IDs
  if (question.allOptions && Array.isArray(question.allOptions) && question.allOptions.length > 0) {
    question.allOptions.forEach((opt: any, index: number) => {
      const optionId = typeof opt.id === 'string' ? parseInt(opt.id, 10) : opt.id;
      if (optionId && !isNaN(optionId)) {
        byId.set(optionId, opt.optionText || opt.text || '');
      }
      byIndex.set(index, opt.optionText || opt.text || '');
    });
    return { byId, byIndex };
  }

  // Legacy fallback: Use options array (index-based)
  if (question.options && Array.isArray(question.options) && question.options.length > 0) {
    question.options.forEach((opt: string, index: number) => {
      byIndex.set(index, opt);
    });
    return { byId, byIndex };
  }

  // Last resort: Use hardcoded fallbacks for known assessment templates
  const legacyOptions = getLegacyQuestionOptions(question.questionText);
  if (legacyOptions) {
    legacyOptions.forEach((opt: string, index: number) => {
      byIndex.set(index, opt);
    });
  }

  return { byId, byIndex };
}

/**
 * Resolves selected option IDs to their display text
 * Handles type coercion defensively and tracks missing IDs for diagnostics
 */
export function resolveSelectedOptionTexts(params: {
  selectedOptionIds: any[];
  optionLookup: OptionLookup;
  allowIndexFallback?: boolean;
}): { texts: string[]; missingIds: number[] } {
  const { selectedOptionIds, optionLookup, allowIndexFallback = true } = params;
  const texts: string[] = [];
  const missingIds: number[] = [];

  if (!selectedOptionIds || !Array.isArray(selectedOptionIds)) {
    return { texts: [], missingIds: [] };
  }

  selectedOptionIds.forEach((rawId) => {
    // Defensive type coercion
    const optionId = typeof rawId === 'string' ? parseInt(rawId, 10) : rawId;
    
    if (isNaN(optionId) || optionId == null) {
      return;
    }

    // Try ID-based lookup first (modern)
    const textById = optionLookup.byId.get(optionId);
    if (textById) {
      texts.push(textById);
      return;
    }

    // Fallback to index-based lookup (legacy)
    if (allowIndexFallback) {
      const textByIndex = optionLookup.byIndex.get(optionId);
      if (textByIndex) {
        texts.push(textByIndex);
        return;
      }
    }

    // Track missing IDs for diagnostics
    missingIds.push(optionId);
  });

  return { texts, missingIds };
}

/**
 * Formats assessment response for display
 * Supports text, rating, and choice-based (radio/checkbox) question types
 */
export function formatResponseDisplay(params: {
  question: any;
  response: any;
}): ResponseDisplayResult {
  const { question, response } = params;

  if (!response) {
    return { primaryText: 'No response provided' };
  }

  // Handle text responses
  if (response.textResponse) {
    return { primaryText: response.textResponse };
  }

  // Handle rating responses
  if (response.ratingValue != null) {
    const value = String(response.ratingValue);
    
    // Include rating labels if available
    if (question.ratingLabels && Array.isArray(question.ratingLabels)) {
      const labelIndex = response.ratingValue - (question.ratingMin || 0);
      const label = question.ratingLabels[labelIndex];
      return {
        primaryText: value,
        secondaryText: label || undefined
      };
    }
    
    return { primaryText: value };
  }

  // Handle choice-based responses (radio/checkbox)
  if (response.selectedOptions && response.selectedOptions.length > 0) {
    const optionLookup = createOptionLookup(question);
    const { texts, missingIds } = resolveSelectedOptionTexts({
      selectedOptionIds: response.selectedOptions,
      optionLookup
    });

    if (texts.length > 0) {
      return {
        primaryText: texts.join(', '),
        missingOptionIds: missingIds.length > 0 ? missingIds : undefined
      };
    }

    return {
      primaryText: 'No selection made',
      missingOptionIds: missingIds.length > 0 ? missingIds : undefined
    };
  }

  return { primaryText: 'No response provided' };
}

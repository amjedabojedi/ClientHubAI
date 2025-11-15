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
  
  // BDI-II - All 21 Items
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
  if (text.includes('punishment feelings')) {
    return ["I don't feel I am being punished.", 'I feel I may be punished.', 'I expect to be punished.', 'I feel I am being punished.'];
  }
  if (text.includes('self-dislike')) {
    return ['I feel the same about myself as ever.', 'I have lost confidence in myself.', 'I am disappointed in myself.', 'I dislike myself.'];
  }
  if (text.includes('self-criticalness')) {
    return ["I don't criticize or blame myself more than usual.", 'I am more critical of myself than I used to be.', 'I criticize myself for all of my faults.', 'I blame myself for everything bad that happens.'];
  }
  if (text.includes('suicidal thoughts')) {
    return ["I don't have any thoughts of killing myself.", 'I have thoughts of killing myself, but I would not carry them out.', 'I would like to kill myself.', 'I would kill myself if I had the chance.'];
  }
  if (text.includes('crying')) {
    return ["I don't cry anymore than I used to.", 'I cry more than I used to.', 'I cry over every little thing.', "I feel like crying, but I can't."];
  }
  if (text.includes('agitation')) {
    return ['I am no more restless or wound up than usual.', 'I feel more restless or wound up than usual.', "I am so restless or agitated that it's hard to stay still.", 'I am so restless or agitated that I have to keep moving or doing something.'];
  }
  if (text.includes('loss of interest')) {
    return ['I have not lost interest in other people or activities.', 'I am less interested in other people or things than before.', 'I have lost most of my interest in other people or things.', "It's hard to get interested in anything."];
  }
  if (text.includes('indecisiveness')) {
    return ['I make decisions about as well as ever.', 'I find it more difficult to make decisions than usual.', 'I have much greater difficulty in making decisions than I used to.', 'I have trouble making any decisions.'];
  }
  if (text.includes('worthlessness')) {
    return ['I do not feel I am worthless.', "I don't consider myself as worthwhile and useful as I used to.", 'I feel more worthless as compared to other people.', 'I feel utterly worthless.'];
  }
  if (text.includes('loss of energy')) {
    return ['I have as much energy as ever.', 'I have less energy than I used to have.', "I don't have enough energy to do very much.", "I don't have enough energy to do anything."];
  }
  if (text.includes('changes in sleeping') || text.includes('sleep')) {
    return ['I have not experienced any change in my sleeping pattern.', 'I sleep somewhat more than usual / I sleep somewhat less than usual.', 'I sleep a lot more than usual / I sleep a lot less than usual.', 'I sleep most of the day / I wake up 1-2 hours early and can\'t get back to sleep.'];
  }
  if (text.includes('irritability')) {
    return ['I am no more irritable than usual.', 'I am more irritable than usual.', 'I am much more irritable than usual.', 'I am irritable all the time.'];
  }
  if (text.includes('changes in appetite') || text.includes('appetite')) {
    return ['I have not experienced any change in my appetite.', 'My appetite is somewhat less than usual / My appetite is somewhat greater than usual.', 'My appetite is much less than before / My appetite is much greater than usual.', 'I have no appetite at all / I crave food all the time.'];
  }
  if (text.includes('concentration')) {
    return ['I can concentrate as well as ever.', "I can't concentrate as well as usual.", "It's hard to keep my mind on anything for very long.", "I find I can't concentrate on anything."];
  }
  if (text.includes('tiredness') || text.includes('fatigue')) {
    return ['I am no more tired or fatigued than usual.', 'I get more tired or fatigued more easily than usual.', 'I am too tired or fatigued to do a lot of the things I used to do.', 'I am too tired or fatigued to do most of the things I used to do.'];
  }
  if (text.includes('loss of interest in sex') || text.includes('sex')) {
    return ['I have not noticed any recent change in my interest in sex.', 'I am less interested in sex than I used to be.', 'I am much less interested in sex now.', 'I have lost interest in sex completely.'];
  }
  
  // Other common assessment patterns
  if (text.includes('session format')) {
    return ['in-person', 'video', 'phone'];
  }
  
  // Default fallback for truly unknown questions
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

  // Handle text responses (support both property names for compatibility)
  const textResponse = response.textResponse || response.responseText;
  if (textResponse && textResponse.trim()) {
    return { primaryText: textResponse.trim() };
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

/**
 * Smart Connect Hook
 * 
 * This hook provides intelligent library entry suggestions based on pattern matching
 * and keyword analysis. It helps therapists quickly connect related clinical content.
 * 
 * @see SmartConnectPanel component for UI implementation
 */

import { useReducer, useMemo, useEffect } from 'react';
import type { LibraryEntry, LibraryCategory } from '@shared/schema';

// Extended types with relations
interface LibraryCategoryWithChildren extends LibraryCategory {
  children?: LibraryCategoryWithChildren[];
  entries?: LibraryEntry[];
}

interface LibraryEntryWithDetails extends LibraryEntry {
  category: LibraryCategory;
  createdBy: { id: number; username: string };
}

/**
 * Parse Clinical Pattern Format
 * 
 * Clinical library entries follow a structured coding pattern:
 * Format: [CONDITION][TYPE][NUMBER]_[VARIANT]
 * 
 * Components:
 * - CONDITION: 3-5 letter code (ANX=Anxiety, DEPR=Depression, TRAUM=Trauma, PTSD, ADHD, etc.)
 * - TYPE: Single letter identifying entry purpose
 *   - S = Symptom (parent/root entry describing the clinical presentation)
 *   - I = Intervention (treatment options and therapeutic techniques)
 *   - P = Progress (outcome measures and progress indicators)
 *   - G = Goal (target outcomes and treatment objectives)
 * - NUMBER: Pathway number (1-99) linking related entries across categories
 * - VARIANT: Optional variant number (_1, _2, _3) for multiple options within same pathway
 * 
 * Examples:
 * - ANXS10 = Anxiety Symptom pathway 10
 * - ANXI10_2 = Anxiety Intervention pathway 10, variant 2
 * - ANXP10_1 = Anxiety Progress measure pathway 10, variant 1
 * - ANXG10 = Anxiety Goal pathway 10
 * 
 * Clinical Rationale:
 * Entries with the same CONDITION+PATHWAY are clinically related across categories.
 * For instance, ANXS10 (symptom) connects to ANXI10_1 (intervention) and ANXP10_1
 * (progress measure) to form a complete treatment pathway.
 * 
 * @param title - Library entry title to parse
 * @returns Parsed pattern object or null if title doesn't match pattern
 */
function parseLibraryPattern(title: string) {
  const match = title.match(/^([A-Z]{3,5})([SIPG])(\d+)(?:_(\d+))?$/);
  if (!match) return null;
  return {
    condition: match[1],    // e.g., "ANX", "DEPR"
    type: match[2] as 'S' | 'I' | 'P' | 'G',
    pathway: match[3],      // e.g., "10", "24"
    variant: match[4] || null
  };
}

/**
 * Get Clinically Related Categories
 * 
 * Defines which library categories are clinically related for keyword-based matching.
 * Used when pattern matching doesn't find results, to suggest related content from
 * appropriate categories.
 * 
 * Clinical Category Relationships:
 * - Session Focus ↔ Symptoms, Goals, Interventions, Progress
 * - Symptoms → Interventions (treatments for symptoms), Progress (tracking improvement)
 * - Interventions → Progress (measuring intervention effectiveness)
 * - Goals ↔ All (goals connect to all aspects of treatment)
 * 
 * @param categoryName - Name of the current category
 * @returns Array of related category names for cross-category suggestions
 */
function getRelatedCategories(categoryName: string): string[] {
  const relationships: Record<string, string[]> = {
    'session focus': ['symptoms', 'short-term goals', 'interventions', 'progress'],
    'symptoms': ['session focus', 'interventions', 'progress', 'short-term goals'],
    'short-term goals': ['session focus', 'interventions', 'progress', 'symptoms'],
    'interventions': ['session focus', 'symptoms', 'short-term goals', 'progress'],
    'progress': ['session focus', 'symptoms', 'short-term goals', 'interventions']
  };
  return relationships[categoryName.toLowerCase()] || [];
}

interface SuggestionEntry extends LibraryEntryWithDetails {
  confidence: number;
  reason: string;
}

interface SmartConnectState {
  selectedIds: number[];
  activeCategory: string | null; // null = "All"
  searchTerm: string;
  visibleCount: number;
  patternMatches: SuggestionEntry[];
  keywordMatches: SuggestionEntry[];
  manualCatalog: LibraryEntryWithDetails[];
}

type SmartConnectAction =
  | { type: 'INIT'; payload: { patternMatches: SuggestionEntry[]; keywordMatches: SuggestionEntry[]; manualCatalog: LibraryEntryWithDetails[] } }
  | { type: 'TOGGLE_SELECTION'; payload: number }
  | { type: 'SET_CATEGORY'; payload: string | null }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'LOAD_MORE' }
  | { type: 'SYNC_SELECTIONS'; payload: number[] }
  | { type: 'CLEAR_SELECTIONS' };

function smartConnectReducer(state: SmartConnectState, action: SmartConnectAction): SmartConnectState {
  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        patternMatches: action.payload.patternMatches,
        keywordMatches: action.payload.keywordMatches,
        manualCatalog: action.payload.manualCatalog
      };
    case 'TOGGLE_SELECTION':
      return {
        ...state,
        selectedIds: state.selectedIds.includes(action.payload)
          ? state.selectedIds.filter(id => id !== action.payload)
          : [...state.selectedIds, action.payload]
      };
    case 'SET_CATEGORY':
      return { ...state, activeCategory: action.payload, visibleCount: 10 };
    case 'SET_SEARCH':
      return { ...state, searchTerm: action.payload, visibleCount: 10 };
    case 'LOAD_MORE':
      return { ...state, visibleCount: state.visibleCount + 20 };
    case 'SYNC_SELECTIONS':
      return { ...state, selectedIds: action.payload };
    case 'CLEAR_SELECTIONS':
      return { ...state, selectedIds: [] };
    default:
      return state;
  }
}

interface UseSmartConnectOptions {
  currentTitle: string;
  currentTags: string;
  currentCategoryId: number;
  currentEntryId?: number;
  allEntries: LibraryEntryWithDetails[];
  categories: LibraryCategoryWithChildren[];
  initialSelections?: number[];
}

export function useSmartConnect({
  currentTitle,
  currentTags,
  currentCategoryId,
  currentEntryId,
  allEntries,
  categories,
  initialSelections = []
}: UseSmartConnectOptions) {
  const [state, dispatch] = useReducer(smartConnectReducer, {
    selectedIds: initialSelections,
    activeCategory: null,
    searchTerm: '',
    visibleCount: 10,
    patternMatches: [],
    keywordMatches: [],
    manualCatalog: []
  });

  // Get current category info
  const currentCategory = useMemo(
    () => categories.find(c => c.id === currentCategoryId),
    [categories, currentCategoryId]
  );

  /**
   * Build Suggestion Buckets
   * 
   * Creates three types of suggestions with different confidence levels:
   * 
   * 1. Pattern Matches (100% confidence):
   *    - Finds entries with same CONDITION + PATHWAY (e.g., ANX10)
   *    - Clinically validated relationships across categories
   *    - Example: Editing ANXS10 suggests ANXI10_1, ANXP10_1, ANXG10
   * 
   * 2. Keyword Matches (60% confidence):
   *    - Used only when NO pattern matches exist
   *    - Compares keywords from title and tags
   *    - Only searches clinically related categories
   *    - Example: "anxiety therapy" matches "anxiety coping" in Interventions
   * 
   * 3. Manual Catalog:
   *    - All remaining entries not in pattern/keyword matches
   *    - Allows manual browsing when automated suggestions insufficient
   * 
   * Architectural Decision:
   * Pattern and keyword matches are mutually exclusive to prevent suggestion
   * overload. Pattern matching (when available) is more clinically reliable
   * than keyword matching.
   */
  const suggestionBuckets = useMemo(() => {
    if (!currentTitle) {
      return { patternMatches: [], keywordMatches: [], manualCatalog: allEntries };
    }

    const currentPattern = parseLibraryPattern(currentTitle);
    let patternMatches: SuggestionEntry[] = [];
    let keywordMatches: SuggestionEntry[] = [];

    // Step 1: Pattern-based matching (100% confidence)
    // Finds entries in the same clinical pathway across all categories
    if (currentPattern) {
      patternMatches = allEntries
        .filter(existing => {
          if (existing.id === currentEntryId) return false;
          const existingPattern = parseLibraryPattern(existing.title);
          if (!existingPattern) return false;
          // Match on condition AND pathway (e.g., ANX + 10)
          return existingPattern.condition === currentPattern.condition &&
                 existingPattern.pathway === currentPattern.pathway;
        })
        .map(e => ({
          ...e,
          confidence: 100,
          reason: `Same pathway #${currentPattern.pathway}`
        }));
    }

    // Step 2: Keyword-based matching (60% confidence)
    // Only used as fallback when pattern matching finds nothing
    if (patternMatches.length === 0 && currentCategory) {
      const keywords = [
        ...currentTitle.toLowerCase().split(' '),
        ...currentTags.toLowerCase().split(',').map((t: string) => t.trim())
      ].filter(k => k.length > 2);

      if (keywords.length > 0) {
        const relatedCategoryNames = getRelatedCategories(currentCategory.name);
        
        keywordMatches = allEntries
          .filter(existing => {
            if (existing.id === currentEntryId) return false;
            if (existing.categoryId === currentCategoryId) return false;
            
            const existingCategoryName = existing.category.name.toLowerCase();
            if (!relatedCategoryNames.includes(existingCategoryName)) return false;
            
            const existingKeywords = [
              ...existing.title.toLowerCase().split(' '),
              ...(existing.tags || []).map(t => t.toLowerCase())
            ];
            
            return keywords.some(keyword => 
              existingKeywords.some(existing => 
                existing.includes(keyword) || keyword.includes(existing)
              )
            );
          })
          .map(e => ({
            ...e,
            confidence: 60,
            reason: 'Shared keywords'
          }));
      }
    }

    // Step 3: Manual catalog (all other entries)
    const manualCatalog = allEntries.filter(e => e.id !== currentEntryId);

    return { patternMatches, keywordMatches, manualCatalog };
  }, [currentTitle, currentTags, currentCategoryId, currentEntryId, allEntries, currentCategory]);

  // Initialize buckets when they change
  useEffect(() => {
    dispatch({ type: 'INIT', payload: suggestionBuckets });
  }, [suggestionBuckets]);

  // Sync selections when parent updates (e.g., editing an entry, form reset)
  useEffect(() => {
    dispatch({ type: 'SYNC_SELECTIONS', payload: initialSelections });
  }, [initialSelections]);

  /**
   * Build Filtered Display List
   * 
   * Filtering Behavior:
   * - Pattern matches: IGNORE category tabs (show across all categories)
   *   Rationale: Clinical pathways span categories (ANXS10 in Symptoms relates
   *   to ANXI10 in Interventions). Category filtering would hide valid matches.
   * 
   * - Keyword matches: RESPECT category filter
   *   Rationale: Keyword matching is less precise, so category filtering helps
   *   narrow results to relevant content.
   * 
   * - Manual catalog: RESPECT category filter
   *   Rationale: Standard browsing behavior users expect.
   * 
   * Search Term: Applied to all lists equally (title and content search)
   * 
   * This asymmetric filtering (pattern vs keyword/manual) balances clinical
   * accuracy with user control.
   */
  const displayList = useMemo(() => {
    const { patternMatches, keywordMatches, manualCatalog } = state;

    // Pattern matches IGNORE category filter (clinically related across categories)
    // Only honor search term
    const patterns = patternMatches.filter(e =>
      !state.searchTerm || 
      e.title.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      e.content.toLowerCase().includes(state.searchTerm.toLowerCase())
    );

    // Keyword matches (only if no pattern matches, RESPECT category filter)
    const keywords = patterns.length === 0 
      ? keywordMatches.filter(e => 
          !state.activeCategory || e.category.name === state.activeCategory
        ).filter(e =>
          !state.searchTerm || 
          e.title.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
          e.content.toLowerCase().includes(state.searchTerm.toLowerCase())
        )
      : [];

    // Manual catalog entries
    const manual = manualCatalog.filter(e => 
      !state.activeCategory || e.category.name === state.activeCategory
    ).filter(e =>
      !state.searchTerm || 
      e.title.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      e.content.toLowerCase().includes(state.searchTerm.toLowerCase())
    ).filter(e => 
      // Exclude entries already in pattern/keyword matches
      !patterns.find(p => p.id === e.id) &&
      !keywords.find(k => k.id === e.id)
    ).slice(0, state.visibleCount);

    return {
      patterns,
      keywords,
      manual,
      totalCount: patterns.length + keywords.length + 
        manualCatalog.filter(e => 
          !state.activeCategory || e.category.name === state.activeCategory
        ).filter(e =>
          !state.searchTerm || 
          e.title.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
          e.content.toLowerCase().includes(state.searchTerm.toLowerCase())
        ).filter(e => 
          !patterns.find(p => p.id === e.id) &&
          !keywords.find(k => k.id === e.id)
        ).length
    };
  }, [state]);

  // Get unique categories for tabs with custom order
  const availableCategories = useMemo(() => {
    const catSet = new Set<string>();
    allEntries.forEach(e => catSet.add(e.category.name));
    
    // Custom order: Session Focus → Symptoms → Short-term Goals → Interventions → Progress
    const preferredOrder = [
      'session focus',
      'symptoms',
      'short-term goals',
      'interventions',
      'progress'
    ];
    
    const categories = Array.from(catSet);
    return categories.sort((a, b) => {
      const indexA = preferredOrder.indexOf(a.toLowerCase());
      const indexB = preferredOrder.indexOf(b.toLowerCase());
      
      // If both are in preferred order, sort by index
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      
      // If only one is in preferred order, it comes first
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      
      // If neither is in preferred order, sort alphabetically
      return a.localeCompare(b);
    });
  }, [allEntries]);

  return {
    state,
    displayList,
    availableCategories,
    toggleSelection: (id: number) => dispatch({ type: 'TOGGLE_SELECTION', payload: id }),
    setCategory: (category: string | null) => dispatch({ type: 'SET_CATEGORY', payload: category }),
    setSearch: (term: string) => dispatch({ type: 'SET_SEARCH', payload: term }),
    loadMore: () => dispatch({ type: 'LOAD_MORE' }),
    syncSelections: (ids: number[]) => dispatch({ type: 'SYNC_SELECTIONS', payload: ids }),
    clearSelections: () => dispatch({ type: 'CLEAR_SELECTIONS' }),
    hasMore: displayList.manual.length < displayList.totalCount - displayList.patterns.length - displayList.keywords.length
  };
}

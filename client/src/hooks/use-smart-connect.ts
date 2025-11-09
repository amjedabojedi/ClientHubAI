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

// Parse library pattern: [CONDITION][TYPE][NUMBER]_[VARIANT]
function parseLibraryPattern(title: string) {
  const match = title.match(/^([A-Z]{3,5})([SIPG])(\d+)(?:_(\d+))?$/);
  if (!match) return null;
  return {
    condition: match[1],
    type: match[2] as 'S' | 'I' | 'P' | 'G',
    pathway: match[3],
    variant: match[4] || null
  };
}

// Get clinically related category names
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

  // Build suggestion buckets (memoized for performance)
  const suggestionBuckets = useMemo(() => {
    if (!currentTitle) {
      return { patternMatches: [], keywordMatches: [], manualCatalog: allEntries };
    }

    const currentPattern = parseLibraryPattern(currentTitle);
    let patternMatches: SuggestionEntry[] = [];
    let keywordMatches: SuggestionEntry[] = [];

    // Step 1: Pattern-based matching (100% confidence)
    if (currentPattern) {
      patternMatches = allEntries
        .filter(existing => {
          if (existing.id === currentEntryId) return false;
          const existingPattern = parseLibraryPattern(existing.title);
          if (!existingPattern) return false;
          return existingPattern.condition === currentPattern.condition &&
                 existingPattern.pathway === currentPattern.pathway;
        })
        .map(e => ({
          ...e,
          confidence: 100,
          reason: `Same pathway #${currentPattern.pathway}`
        }));
    }

    // Step 2: Keyword-based matching (60% confidence) - only if no pattern matches
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

  // Build filtered & sorted display list
  const displayList = useMemo(() => {
    const { patternMatches, keywordMatches, manualCatalog } = state;

    // Pattern matches always visible (pinned to top)
    const patterns = patternMatches.filter(e => 
      !state.activeCategory || e.category.name === state.activeCategory
    ).filter(e =>
      !state.searchTerm || 
      e.title.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      e.content.toLowerCase().includes(state.searchTerm.toLowerCase())
    );

    // Keyword matches (only if no pattern matches)
    const keywords = patternMatches.length === 0 
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

  // Get unique categories for tabs
  const availableCategories = useMemo(() => {
    const catSet = new Set<string>();
    allEntries.forEach(e => catSet.add(e.category.name));
    return Array.from(catSet).sort();
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

import { useState } from 'react';
import { Search, Sparkles, Target, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSmartConnect } from '@/hooks/use-smart-connect';
import type { LibraryEntry, LibraryCategory } from '@shared/schema';

interface LibraryEntryWithDetails extends LibraryEntry {
  category: LibraryCategory;
  createdBy: { id: number; username: string };
}

interface LibraryCategoryWithChildren extends LibraryCategory {
  children?: LibraryCategoryWithChildren[];
  entries?: LibraryEntry[];
}

interface SmartConnectPanelProps {
  currentTitle: string;
  currentTags: string;
  currentCategoryId: number;
  currentEntryId?: number;
  allEntries: LibraryEntryWithDetails[];
  categories: LibraryCategoryWithChildren[];
  selectedConnections: number[];
  onSelectionChange: (selectedIds: number[]) => void;
}

export function SmartConnectPanel({
  currentTitle,
  currentTags,
  currentCategoryId,
  currentEntryId,
  allEntries,
  categories,
  selectedConnections,
  onSelectionChange
}: SmartConnectPanelProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'pattern' | 'other' | 'all'>('all');

  // MUST call hooks before any conditional returns (Rules of Hooks)
  const {
    state,
    displayList,
    availableCategories,
    toggleSelection,
    setCategory,
    setSearch,
    loadMore,
    hasMore,
    syncSelections
  } = useSmartConnect({
    currentTitle,
    currentTags,
    currentCategoryId,
    currentEntryId,
    allEntries,
    categories,
    initialSelections: selectedConnections
  });

  // Calculate individual tab counts
  const patternCount = displayList.patterns.length;
  const keywordCount = displayList.keywords.length;
  const manualCount = displayList.manual.length;
  const allCount = patternCount + keywordCount + manualCount;
  
  const showPanel = currentTitle.length > 0;

  // Sync selections with parent
  const handleToggle = (id: number) => {
    toggleSelection(id);
    const newSelections = state.selectedIds.includes(id)
      ? state.selectedIds.filter(sid => sid !== id)
      : [...state.selectedIds, id];
    onSelectionChange(newSelections);
  };

  // Handle search with debounce
  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setSearch(value);
  };

  // Handle Select All for current tab - REPLACES existing selections
  const handleSelectAll = () => {
    let entriesToSelect: any[] = [];
    
    if (activeTab === 'pattern') {
      entriesToSelect = displayList.patterns;
    } else if (activeTab === 'other') {
      entriesToSelect = displayList.keywords;
    } else {
      // All tab includes patterns, keywords, AND manual entries
      entriesToSelect = [...displayList.patterns, ...displayList.keywords, ...displayList.manual];
    }
    
    const newSelections = entriesToSelect.map(e => e.id);
    
    // Sync selections to local state and parent
    syncSelections(newSelections);
    onSelectionChange(newSelections);
  };

  // Empty state - show AFTER hooks are called
  if (!showPanel) {
    return (
      <div className="bg-gray-50 dark:bg-gray-900/20 p-6 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-center">
        <Brain className="w-8 h-8 text-gray-400 dark:text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Enter a title to see Smart Connect suggestions
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with counts */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h4 className="font-semibold text-gray-900 dark:text-gray-100">
            Smart Connect
          </h4>
        </div>
        {state.selectedIds.length > 0 && (
          <Badge className="bg-blue-600 text-white">
            {state.selectedIds.length} selected
          </Badge>
        )}
      </div>

      {/* Category Tabs */}
      <Tabs
        value={state.activeCategory || availableCategories[0]}
        onValueChange={(val) => setCategory(val)}
      >
        <TabsList className="w-full justify-start overflow-x-auto flex-wrap h-auto gap-1">
          {availableCategories.map(cat => {
            const count = allEntries.filter(e => e.category.name === cat).length;
            return (
              <TabsTrigger key={cat} value={cat} className="text-xs">
                {cat} {count > 0 && `(${count})`}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search connections..."
          className="pl-9"
          data-testid="input-search-connections"
        />
      </div>

      {/* Pattern/Other/All Tabs with Select All - always shown */}
      <div className="flex items-center justify-between gap-3">
        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)} className="flex-1">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="pattern" className="text-xs">
              Pattern {patternCount > 0 && `(${patternCount})`}
            </TabsTrigger>
            <TabsTrigger value="other" className="text-xs">
              Other {keywordCount > 0 && `(${keywordCount})`}
            </TabsTrigger>
            <TabsTrigger value="all" className="text-xs">
              All ({allCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSelectAll}
          disabled={
            (activeTab === 'pattern' && patternCount === 0) ||
            (activeTab === 'other' && keywordCount === 0) ||
            (activeTab === 'all' && allCount === 0)
          }
          data-testid="button-select-all"
        >
          Select All
        </Button>
      </div>

      {/* Suggestions List */}
      <ScrollArea className="h-[400px] rounded-lg border border-gray-200 dark:border-gray-800">
        <div className="p-4 space-y-4">
          {/* Pattern Matches - shown in Pattern and All tabs */}
          {(activeTab === 'pattern' || activeTab === 'all') && displayList.patterns.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-green-600 dark:text-green-400" />
                <h5 className="font-medium text-green-900 dark:text-green-100 text-sm">
                  Pattern Matches
                  <Badge className="ml-2 bg-green-600 text-white text-xs">
                    100% Confidence
                  </Badge>
                </h5>
              </div>
              {displayList.patterns.map((entry: any) => (
                <SuggestionCard
                  key={entry.id}
                  entry={entry}
                  isSelected={state.selectedIds.includes(entry.id)}
                  onToggle={handleToggle}
                  confidence={entry.confidence}
                  reason={entry.reason}
                  highlight="pattern"
                />
              ))}
            </div>
          )}

          {/* Keyword Matches - shown in Other and All tabs */}
          {(activeTab === 'other' || activeTab === 'all') && displayList.keywords.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h5 className="font-medium text-blue-900 dark:text-blue-100 text-sm">
                  Keyword Matches
                  <Badge className="ml-2 bg-blue-600 text-white text-xs">
                    60% Confidence
                  </Badge>
                </h5>
              </div>
              {displayList.keywords.map((entry: any) => (
                <SuggestionCard
                  key={entry.id}
                  entry={entry}
                  isSelected={state.selectedIds.includes(entry.id)}
                  onToggle={handleToggle}
                  confidence={entry.confidence}
                  reason={entry.reason}
                  highlight="keyword"
                />
              ))}
            </div>
          )}

          {/* Manual Catalog - only show in "All" tab */}
          {activeTab === 'all' && displayList.manual.length > 0 && (
            <div className="space-y-2">
              {(patternCount > 0 || keywordCount > 0) && (
                <div className="border-t border-gray-200 dark:border-gray-700 my-4" />
              )}
              <h5 className="font-medium text-gray-700 dark:text-gray-300 text-sm mb-3">
                Other Entries
              </h5>
              {displayList.manual.map((entry) => (
                <SuggestionCard
                  key={entry.id}
                  entry={entry}
                  isSelected={state.selectedIds.includes(entry.id)}
                  onToggle={handleToggle}
                  highlight="none"
                />
              ))}
            </div>
          )}

          {/* Load More */}
          {hasMore && (
            <Button
              variant="outline"
              onClick={loadMore}
              className="w-full"
              data-testid="button-load-more-connections"
            >
              Load 20 More
            </Button>
          )}

          {/* Empty State */}
          {(() => {
            let hasContent = false;
            
            if (activeTab === 'pattern') {
              hasContent = displayList.patterns.length > 0;
            } else if (activeTab === 'other') {
              hasContent = displayList.keywords.length > 0;
            } else {
              // All tab checks all three lists
              hasContent = 
                displayList.patterns.length > 0 ||
                displayList.keywords.length > 0 ||
                displayList.manual.length > 0;
            }
            
            if (!hasContent) {
              return (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {activeTab === 'pattern' && 'No pattern matches found'}
                    {activeTab === 'other' && 'No keyword matches found'}
                    {activeTab === 'all' && 'No entries found matching your filters'}
                  </p>
                </div>
              );
            }
            return null;
          })()}
        </div>
      </ScrollArea>

      {/* Summary */}
      {state.selectedIds.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            ✓ {state.selectedIds.length} connection(s) will be created when you save
          </p>
        </div>
      )}
    </div>
  );
}

// Suggestion Card Component
interface SuggestionCardProps {
  entry: any;
  isSelected: boolean;
  onToggle: (id: number) => void;
  confidence?: number;
  reason?: string;
  highlight: 'pattern' | 'keyword' | 'none';
}

function SuggestionCard({
  entry,
  isSelected,
  onToggle,
  confidence,
  reason,
  highlight
}: SuggestionCardProps) {
  const bgClass = highlight === 'pattern'
    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    : highlight === 'keyword'
    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';

  return (
    <label
      className={`flex items-start gap-3 p-3 rounded border cursor-pointer hover:shadow-sm transition-shadow ${bgClass}`}
      data-testid={`suggestion-card-${entry.id}`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(entry.id)}
        className="mt-1 rounded"
        data-testid={`checkbox-connection-${entry.id}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <Badge variant="outline" className="text-xs">
            {entry.category.name}
          </Badge>
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {entry.title}
          </span>
          {confidence && (
            <Badge
              className="text-xs"
              variant={confidence === 100 ? 'default' : 'secondary'}
            >
              {confidence}%
            </Badge>
          )}
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
          {entry.content}
        </p>
        {reason && (
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 italic">
            {reason}
          </p>
        )}
      </div>
    </label>
  );
}

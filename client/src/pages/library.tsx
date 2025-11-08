import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, FolderOpen, FileText, Edit, Trash2, ChevronRight, ChevronDown, Tag, Clock, Link2, X, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";
import type { LibraryCategory, LibraryEntry, InsertLibraryCategory, InsertLibraryEntry } from "@shared/schema";

interface LibraryCategoryWithChildren extends LibraryCategory {
  children?: LibraryCategoryWithChildren[];
  entries?: LibraryEntry[];
}

interface LibraryEntryWithDetails extends LibraryEntry {
  category: LibraryCategory;
  createdBy: { id: number; username: string };
}


export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [showAddEntryDialog, setShowAddEntryDialog] = useState(false);
  const [showBulkAddDialog, setShowBulkAddDialog] = useState(false);
  const [editingCategory, setEditingCategory] = useState<LibraryCategoryWithChildren | null>(null);
  const [editingEntry, setEditingEntry] = useState<LibraryEntryWithDetails | null>(null);
  const [connectingEntry, setConnectingEntry] = useState<LibraryEntryWithDetails | null>(null);
  const [connectedEntriesMap, setConnectedEntriesMap] = useState<Record<number, any[]>>({});
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const debouncedSearchQuery = useDebounce(searchQuery, 300);




  // Fetch all categories (still needed for form dropdowns)
  const { data: categories = [], isLoading: loadingCategories } = useQuery<LibraryCategoryWithChildren[]>({
    queryKey: ["/api/library/categories"],
  });

  // Set initial active tab to first category when categories load
  useEffect(() => {
    if (categories.length > 0 && !activeTab) {
      setActiveTab(categories[0].id.toString());
    }
  }, [categories, activeTab]);

  // Get current category ID from active tab
  const currentCategoryId = categories.find(cat => cat.id.toString() === activeTab)?.id;

  // Fetch entries for current active tab category
  const { data: entries = [], isLoading: loadingEntries } = useQuery<LibraryEntryWithDetails[]>({
    queryKey: ["/api/library/entries", currentCategoryId],
    queryFn: async () => {
      const url = currentCategoryId ? `/api/library/entries?categoryId=${currentCategoryId}` : "/api/library/entries";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch entries");
      return response.json();
    },
  });

  // Fetch ALL entries for connections (regardless of active tab)
  const { data: allEntries = [] } = useQuery<LibraryEntryWithDetails[]>({
    queryKey: ["/api/library/entries"],
    queryFn: async () => {
      const response = await fetch("/api/library/entries");
      if (!response.ok) throw new Error("Failed to fetch all entries");
      return response.json();
    },
  });

  // Search entries
  const { data: searchResults = [], isLoading: searching } = useQuery<LibraryEntryWithDetails[]>({
    queryKey: ["/api/library/search", debouncedSearchQuery, currentCategoryId],
    queryFn: async () => {
      if (!debouncedSearchQuery.trim()) return [];
      const url = currentCategoryId 
        ? `/api/library/search?q=${encodeURIComponent(debouncedSearchQuery)}&categoryId=${currentCategoryId}`
        : `/api/library/search?q=${encodeURIComponent(debouncedSearchQuery)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to search entries");
      return response.json();
    },
    enabled: !!debouncedSearchQuery.trim(),
  });

  // Category mutations
  const createCategoryMutation = useMutation({
    mutationFn: (data: InsertLibraryCategory) => apiRequest("/api/library/categories", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/categories"] });
      setShowAddCategoryDialog(false);
      toast({ title: "Category created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create category", variant: "destructive" });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<InsertLibraryCategory> }) =>
      apiRequest(`/api/library/categories/${id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/categories"] });
      setEditingCategory(null);
      toast({ title: "Category updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update category", variant: "destructive" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/library/categories/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/categories"] });
      toast({ title: "Category deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete category", variant: "destructive" });
    },
  });

  // Entry mutations
  const createEntryMutation = useMutation({
    mutationFn: async (data: InsertLibraryEntry & { selectedConnections?: number[] }) => {
      const { selectedConnections, ...entryData } = data;
      
      // Create the entry first
      const entry = await apiRequest("/api/library/entries", "POST", entryData) as unknown as LibraryEntry;
      
      // Create auto-connections if any were selected
      if (selectedConnections && selectedConnections.length > 0) {
        const connectionPromises = selectedConnections.map(targetId => 
          apiRequest("/api/library/connections", "POST", {
            fromEntryId: entry.id,
            toEntryId: targetId,
            connectionType: "relates_to",
            strength: 4, // Default strong connection for auto-detected (1-5 scale)
            description: "Auto-connected based on shared keywords",
            createdById: 6
          })
        );
        await Promise.all(connectionPromises);
      }
      
      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/entries"] });
      setShowAddEntryDialog(false);
      toast({ title: "Entry created successfully with auto-connections" });
    },
    onError: () => {
      toast({ title: "Failed to create entry", variant: "destructive" });
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertLibraryEntry> & { selectedConnections?: number[] } }) => {
      const { selectedConnections, ...entryData } = data;
      
      // Update the entry first
      const entry = await apiRequest(`/api/library/entries/${id}`, "PUT", entryData);
      
      // Create auto-connections if any were selected
      if (selectedConnections && selectedConnections.length > 0) {
        const connectionPromises = selectedConnections.map(targetId => 
          apiRequest("/api/library/connections", "POST", {
            fromEntryId: id,
            toEntryId: targetId,
            connectionType: "relates_to",
            strength: 4,
          })
        );
        
        await Promise.all(connectionPromises);
      }
      
      return entry;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/entries"] });
      setEditingEntry(null);
      const connectCount = (variables.data as any).selectedConnections?.length || 0;
      toast({ 
        title: connectCount > 0 
          ? `Entry updated with ${connectCount} new connection(s)` 
          : "Entry updated successfully" 
      });
    },
    onError: () => {
      toast({ title: "Failed to update entry", variant: "destructive" });
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/library/entries/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/entries"] });
      toast({ title: "Entry deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete entry", variant: "destructive" });
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: (connectionId: number) => apiRequest(`/api/library/connections/${connectionId}`, "DELETE"),
    onSuccess: () => {
      setConnectedEntriesMap({});
      queryClient.invalidateQueries({ queryKey: ["/api/library/entries"] });
      toast({ title: "Connection removed successfully" });
    },
    onError: () => {
      toast({ title: "Failed to remove connection", variant: "destructive" });
    },
  });

  const deleteAllConnectionsMutation = useMutation({
    mutationFn: (entryId: number) => apiRequest(`/api/library/entries/${entryId}/connections`, "DELETE"),
    onSuccess: () => {
      setConnectedEntriesMap({});
      queryClient.invalidateQueries({ queryKey: ["/api/library/entries"] });
      toast({ title: "All connections removed successfully" });
    },
    onError: () => {
      toast({ title: "Failed to remove connections", variant: "destructive" });
    },
  });

  // Helper function
  const getAllCategories = (cats: LibraryCategoryWithChildren[], level = 0): Array<LibraryCategoryWithChildren & { level: number }> => {
    let result: Array<LibraryCategoryWithChildren & { level: number }> = [];
    for (const cat of cats) {
      result.push({ ...cat, level });
      if (cat.children) {
        result = result.concat(getAllCategories(cat.children, level + 1));
      }
    }
    return result;
  };

  const displayedEntries = searchQuery.trim() ? searchResults : entries;

  // Fetch connected entries for displayed entries
  useEffect(() => {
    const fetchConnections = async () => {
      const entryIds = displayedEntries.map(e => e.id);
      const connectionsPromises = entryIds.map(async (id) => {
        try {
          const response = await fetch(`/api/library/entries/${id}/connected`);
          if (response.ok) {
            const connected = await response.json();
            return { entryId: id, connected };
          }
        } catch (error) {
          // Connection fetch failed - ignore silently  
        }
        return { entryId: id, connected: [] };
      });

      const results = await Promise.all(connectionsPromises);
      const newMap: Record<number, any[]> = {};
      results.forEach(({ entryId, connected }) => {
        newMap[entryId] = connected;
      });
      setConnectedEntriesMap(newMap);
    };

    if (displayedEntries.length > 0) {
      fetchConnections();
    }
  }, [displayedEntries]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Clinical Content Library</h1>
          <p className="text-slate-600 mt-1">
            Organize and access reusable clinical content for session notes
          </p>
        </div>

        {/* Tab-based Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className={`grid w-full grid-cols-${Math.min(categories.length, 6)}`}>
            {categories.map((category) => (
              <TabsTrigger key={category.id} value={category.id.toString()}>
                {category.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((category) => (
            <TabsContent key={category.id} value={category.id.toString()} className="mt-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{category.name}</CardTitle>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {category.description || `Clinical content for ${category.name.toLowerCase()}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowBulkAddDialog(true)}
                        className="flex items-center gap-1"
                      >
                        <Upload className="w-4 h-4" />
                        Bulk Add
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setShowAddEntryDialog(true)}
                        className="flex items-center gap-1"
                      >
                        <Plus className="w-4 h-4" />
                        Add Entry
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        placeholder={`Search ${category.name.toLowerCase()}...`}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                <ScrollArea className="h-[600px]">
                  {loadingEntries || searching ? (
                    <div className="p-4 text-center text-gray-500">Loading entries...</div>
                  ) : displayedEntries.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      {searchQuery.trim() ? 'No entries found matching your search.' : 'No entries in this category yet.'}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {displayedEntries.map((entry) => {
                        // Only show database connections (no tag-based fallback)
                        const databaseConnections = connectedEntriesMap[entry.id] || [];

                        return (
                          <Card key={entry.id} data-entry-id={entry.id} className="border-l-4 border-l-blue-500">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                                    {entry.title}
                                  </h3>
                                  <p className="text-gray-600 dark:text-gray-400 text-sm mb-3 line-clamp-2">
                                    {entry.content}
                                  </p>
                                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                                    <Badge variant="secondary" className="text-xs">
                                      {entry.category.name}
                                    </Badge>
                                    {entry.tags && entry.tags.length > 0 && (
                                      <div className="flex items-center gap-1">
                                        <Tag className="w-3 h-3" />
                                        {entry.tags.slice(0, 2).map((tag, idx) => (
                                          <Badge key={idx} variant="outline" className="text-xs">
                                            {tag}
                                          </Badge>
                                        ))}
                                        {entry.tags.length > 2 && (
                                          <span className="text-xs">+{entry.tags.length - 2} more</span>
                                        )}
                                      </div>
                                    )}
                                    <div className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      <span>Used {entry.usageCount || 0} times</span>
                                    </div>
                                  </div>
                                  
                                  {/* Connections Section */}
                                  {databaseConnections.length > 0 && (
                                    <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                          <Link2 className="w-3 h-3" />
                                          <span className="font-medium">
                                            Connections ({databaseConnections.length})
                                          </span>
                                        </div>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteAllConnectionsMutation.mutate(entry.id);
                                          }}
                                          className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 hover:underline"
                                          title="Remove all connections"
                                          data-testid={`button-remove-all-connections-${entry.id}`}
                                        >
                                          Delete All
                                        </button>
                                      </div>
                                      <div className="flex items-center gap-2 text-xs flex-wrap">
                                        {databaseConnections.map((related, idx) => (
                                          <span key={`${entry.id}-${related.id}-${idx}`} className="inline-flex items-center gap-1">
                                            <span 
                                              className="text-blue-600 dark:text-blue-400 cursor-pointer hover:underline bg-blue-50 dark:bg-blue-900/20 px-1 py-0.5 rounded"
                                              onClick={() => {
                                                const element = document.querySelector(`[data-entry-id="${related.id}"]`);
                                                element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                              }}
                                              title="Click to scroll to entry"
                                            >
                                              {related.title}
                                            </span>
                                            {(related as any).connectionId && (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  deleteConnectionMutation.mutate((related as any).connectionId);
                                                }}
                                                className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                                                title="Remove connection"
                                                data-testid={`button-remove-connection-${(related as any).connectionId}`}
                                              >
                                                <X className="w-3 h-3" />
                                              </button>
                                            )}
                                            {idx < databaseConnections.length - 1 && <span>,</span>}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 ml-4">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConnectingEntry(entry)}
                                    title="Connect to other entries"
                                  >
                                    <Link2 className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingEntry(entry)}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => deleteEntryMutation.mutate(entry.id)}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        {/* Add Category Dialog */}
        <Dialog open={showAddCategoryDialog} onOpenChange={setShowAddCategoryDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Category</DialogTitle>
            </DialogHeader>
            <CategoryForm
              onSubmit={(data) => createCategoryMutation.mutate(data)}
              categories={getAllCategories(categories)}
              isLoading={createCategoryMutation.isPending}
            />
          </DialogContent>
        </Dialog>

        {/* Edit Category Dialog */}
        <Dialog open={!!editingCategory} onOpenChange={() => setEditingCategory(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Category</DialogTitle>
            </DialogHeader>
            {editingCategory && (
              <CategoryForm
                category={editingCategory}
                onSubmit={(data) => updateCategoryMutation.mutate({ id: editingCategory.id, data })}
                categories={getAllCategories(categories)}
                isLoading={updateCategoryMutation.isPending}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Add Entry Dialog */}
        <Dialog open={showAddEntryDialog} onOpenChange={setShowAddEntryDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Entry</DialogTitle>
            </DialogHeader>
            <EntryForm
              onSubmit={(data) => createEntryMutation.mutate(data as any)}
              categories={getAllCategories(categories)}
              selectedCategoryId={currentCategoryId}
              isLoading={createEntryMutation.isPending}
              allEntries={allEntries}
            />
          </DialogContent>
        </Dialog>

        {/* Edit Entry Dialog */}
        <Dialog open={!!editingEntry} onOpenChange={() => setEditingEntry(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Entry</DialogTitle>
            </DialogHeader>
            {editingEntry && (
              <EntryForm
                entry={editingEntry}
                onSubmit={(data) => updateEntryMutation.mutate({ id: editingEntry.id, data })}
                categories={getAllCategories(categories)}
                selectedCategoryId={editingEntry.categoryId}
                isLoading={updateEntryMutation.isPending}
                allEntries={allEntries}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Connect Entry Dialog */}
        <Dialog open={!!connectingEntry} onOpenChange={() => setConnectingEntry(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Connect "{connectingEntry?.title}" to Other Entries</DialogTitle>
            </DialogHeader>
            {connectingEntry && (
              <ConnectionForm
                sourceEntry={connectingEntry}
                allEntries={allEntries}
                categories={categories}
                onConnectionCreated={() => {
                  // Refresh connections
                  setConnectedEntriesMap({});
                  setConnectingEntry(null);
                  // Refresh entries to show new connections
                  queryClient.invalidateQueries({ queryKey: ["/api/library/entries"] });
                }}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Bulk Add Dialog */}
        <Dialog open={showBulkAddDialog} onOpenChange={setShowBulkAddDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Bulk Add Library Entries</DialogTitle>
            </DialogHeader>
            <BulkAddForm
              categoryId={currentCategoryId}
              categories={categories}
              onComplete={() => {
                setShowBulkAddDialog(false);
                queryClient.invalidateQueries({ queryKey: ["/api/library/entries"] });
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// Bulk Add Form Component
function BulkAddForm({
  categoryId,
  categories,
  onComplete
}: {
  categoryId?: number;
  categories: LibraryCategoryWithChildren[];
  onComplete: () => void;
}) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>(categoryId);
  const [pastedData, setPastedData] = useState("");
  const [parsedEntries, setParsedEntries] = useState<Array<{ title: string; content: string; error?: string }>>([]);
  const { toast } = useToast();

  // Parse pasted data when it changes
  useEffect(() => {
    if (!pastedData.trim()) {
      setParsedEntries([]);
      return;
    }

    const lines = pastedData.split('\n').filter(line => line.trim());
    const entries: Array<{ title: string; content: string; error?: string }> = [];

    lines.forEach((line, index) => {
      // Try TAB separator first, then comma
      let parts = line.split('\t');
      if (parts.length < 2) {
        parts = line.split(',');
      }
      
      if (parts.length < 2) {
        entries.push({
          title: parts[0] || '',
          content: '',
          error: 'Missing content column (must have 2 columns: Title and Content)'
        });
      } else {
        const title = parts[0]?.trim() || '';
        const content = parts[1]?.trim() || '';
        
        if (!title) {
          entries.push({ title: '', content, error: 'Title is required' });
        } else if (!content) {
          entries.push({ title, content: '', error: 'Content is required' });
        } else {
          entries.push({ title, content });
        }
      }
    });

    setParsedEntries(entries);
  }, [pastedData]);

  const validEntries = parsedEntries.filter(e => !e.error);
  const invalidEntries = parsedEntries.filter(e => e.error);

  const handleImport = async () => {
    if (!selectedCategoryId) {
      toast({
        title: "Category required",
        description: "Please select a category first",
        variant: "destructive"
      });
      return;
    }

    if (validEntries.length === 0) {
      toast({
        title: "No valid entries",
        description: "Please paste valid data with Title and Content columns",
        variant: "destructive"
      });
      return;
    }

    try {
      const response = await apiRequest('/api/library/bulk-entries', 'POST', {
        categoryId: selectedCategoryId,
        entries: validEntries
      }) as any;

      const successCount = response.successful || 0;
      const skippedCount = response.skipped || 0;
      const failedCount = response.failed || 0;

      let description = `✓ ${successCount} created`;
      if (skippedCount > 0) description += `, ${skippedCount} skipped (duplicates)`;
      if (failedCount > 0) description += `, ${failedCount} failed`;

      toast({
        title: successCount > 0 ? "Import complete!" : "Import completed with issues",
        description,
        variant: successCount > 0 ? "default" : "destructive"
      });

      if (successCount > 0) {
        onComplete();
      }
    } catch (error: any) {
      toast({
        title: "Import failed",
        description: error.message || "Failed to import entries",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Step 1: Select Category */}
      <div>
        <Label htmlFor="bulk-category">Step 1: Select Category *</Label>
        <Select
          value={selectedCategoryId?.toString()}
          onValueChange={(value) => setSelectedCategoryId(parseInt(value))}
        >
          <SelectTrigger id="bulk-category">
            <SelectValue placeholder="Choose a category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map(cat => (
              <SelectItem key={cat.id} value={cat.id.toString()}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-slate-500 mt-1">
          All imported entries will be added to this category
        </p>
      </div>

      {/* Step 2: Paste Data */}
      <div>
        <Label htmlFor="bulk-paste">Step 2: Paste Excel Data</Label>
        <p className="text-xs text-slate-500 mb-2">
          Copy 2 columns from Excel: <strong>Title</strong> and <strong>Content</strong> (TAB or comma-separated)
        </p>
        <Textarea
          id="bulk-paste"
          value={pastedData}
          onChange={(e) => setPastedData(e.target.value)}
          placeholder="Title,Content
Cognitive Restructuring,A technique to identify and challenge...
DBT Skills,Dialectical behavior therapy skills..."
          rows={8}
          className="font-mono text-sm"
        />
      </div>

      {/* Preview */}
      {parsedEntries.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Preview ({parsedEntries.length} rows)</Label>
            <div className="flex gap-2 text-xs">
              <span className="text-green-600">✓ {validEntries.length} valid</span>
              {invalidEntries.length > 0 && (
                <span className="text-red-600">⚠ {invalidEntries.length} errors</span>
              )}
            </div>
          </div>
          <div className="border rounded-lg max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0">
                <tr>
                  <th className="text-left p-2 w-8">#</th>
                  <th className="text-left p-2">Title</th>
                  <th className="text-left p-2">Content</th>
                  <th className="text-left p-2 w-20">Status</th>
                </tr>
              </thead>
              <tbody>
                {parsedEntries.map((entry, index) => (
                  <tr key={index} className={entry.error ? 'bg-red-50 dark:bg-red-950' : ''}>
                    <td className="p-2 text-slate-500">{index + 1}</td>
                    <td className="p-2 font-medium">{entry.title || <span className="text-slate-400">empty</span>}</td>
                    <td className="p-2 text-slate-600 dark:text-slate-400 truncate max-w-xs">
                      {entry.content || <span className="text-slate-400">empty</span>}
                    </td>
                    <td className="p-2">
                      {entry.error ? (
                        <span className="text-xs text-red-600" title={entry.error}>⚠ Error</span>
                      ) : (
                        <span className="text-xs text-green-600">✓ Valid</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invalidEntries.length > 0 && (
            <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs">
              <strong>Errors:</strong>
              <ul className="list-disc list-inside mt-1">
                {invalidEntries.slice(0, 3).map((entry, index) => (
                  <li key={index}>{entry.error}</li>
                ))}
                {invalidEntries.length > 3 && (
                  <li>... and {invalidEntries.length - 3} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Import Button */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setPastedData("");
            setParsedEntries([]);
          }}
        >
          Clear
        </Button>
        <Button
          onClick={handleImport}
          disabled={validEntries.length === 0 || !selectedCategoryId}
        >
          Import {validEntries.length > 0 && `${validEntries.length} ${validEntries.length === 1 ? 'Entry' : 'Entries'}`}
        </Button>
      </div>
    </div>
  );
}

// Category Form Component
function CategoryForm({ 
  category, 
  onSubmit, 
  categories, 
  isLoading 
}: { 
  category?: LibraryCategoryWithChildren;
  onSubmit: (data: InsertLibraryCategory) => void;
  categories: Array<LibraryCategoryWithChildren & { level: number }>;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    name: category?.name || "",
    description: category?.description || "",
    parentId: category?.parentId || null,
    sortOrder: category?.sortOrder || 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows={3}
        />
      </div>
      <div>
        <Label htmlFor="parentId">Parent Category</Label>
        <Select
          value={formData.parentId?.toString() || "root"}
          onValueChange={(value) => setFormData({ ...formData, parentId: value === "root" ? null : parseInt(value) })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select parent category (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="root">None (Root Category)</SelectItem>
            {categories
              .filter(cat => cat.id !== category?.id) // Prevent self-parenting
              .map(cat => (
                <SelectItem key={cat.id} value={cat.id.toString()}>
                  {"—".repeat(cat.level)} {cat.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="sortOrder">Sort Order</Label>
        <Input
          id="sortOrder"
          type="number"
          value={formData.sortOrder}
          onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving..." : category ? "Update" : "Create"}
        </Button>
      </div>
    </form>
  );
}

// Pattern Parser for Library Entry Codes
// Parses format: [CONDITION][TYPE][NUMBER]_[VARIANT]
// Examples: ANXS10, ANXI10_2, ANXP10_1, DEPR5_1
interface ParsedPattern {
  condition: string;  // ANX, DEPR, TRAUM, PTSD, etc.
  type: string;       // S=Symptom, I=Intervention, P=Progress, G=Goal
  pathway: number;    // The pathway number (1-99)
  variant?: number;   // Optional variant number (_1, _2, _3)
  raw: string;        // Original title
}

function parseLibraryPattern(title: string): ParsedPattern | null {
  if (!title) return null;
  
  // Pattern: [CONDITION][TYPE][NUMBER]_[VARIANT]
  // CONDITION: 3-5 uppercase letters (ANX, DEPR, TRAUM, PTSD)
  // TYPE: Single letter (S, I, P, G)
  // NUMBER: 1-2 digits
  // VARIANT: Optional _1, _2, _3, etc.
  const pattern = /^([A-Z]{3,5})([SIPG])(\d{1,2})(?:_(\d+))?$/;
  const match = title.trim().match(pattern);
  
  if (!match) return null;
  
  return {
    condition: match[1],
    type: match[2],
    pathway: parseInt(match[3]),
    variant: match[4] ? parseInt(match[4]) : undefined,
    raw: title.trim()
  };
}

// Get connection type based on entry types
function getConnectionType(fromType: string, toType: string): string {
  const typeMap: Record<string, Record<string, string>> = {
    'S': { 'I': 'treats', 'P': 'measures', 'G': 'targets' },
    'I': { 'S': 'treats', 'P': 'measures', 'I': 'alternative_to', 'G': 'targets' },
    'P': { 'S': 'measures', 'I': 'measured_by', 'G': 'tracks' },
    'G': { 'S': 'targets', 'I': 'achieved_by', 'P': 'tracked_by' }
  };
  
  return typeMap[fromType]?.[toType] || 'relates_to';
}

// Entry Form Component
function EntryForm({ 
  entry, 
  onSubmit, 
  categories, 
  selectedCategoryId,
  isLoading,
  allEntries = []
}: { 
  entry?: LibraryEntryWithDetails;
  onSubmit: (data: InsertLibraryEntry) => void;
  categories: Array<LibraryCategoryWithChildren & { level: number }>;
  selectedCategoryId?: number | null;
  isLoading: boolean;
  allEntries?: LibraryEntryWithDetails[];
}) {
  const [formData, setFormData] = useState({
    title: entry?.title || "",
    content: entry?.content || "",
    categoryId: entry?.categoryId || selectedCategoryId || (categories[0]?.id || 0),
    tags: entry?.tags?.join(", ") || "",
    sortOrder: entry?.sortOrder || 0,
    createdById: entry?.createdById || 6,
  });
  
  const [suggestedConnections, setSuggestedConnections] = useState<LibraryEntryWithDetails[]>([]);
  const [selectedConnections, setSelectedConnections] = useState<number[]>([]);

  // Helper: Get clinically related category names for smart connections
  const getRelatedCategories = (categoryId: number): string[] => {
    const currentCategory = categories.find(c => c.id === categoryId);
    if (!currentCategory) return [];

    const categoryName = currentCategory.name.toLowerCase();

    // Define clinical relationships between categories
    const relationships: Record<string, string[]> = {
      'session focus': ['symptoms', 'short-term goals', 'interventions'],
      'symptoms': ['session focus', 'interventions', 'progress'],
      'short-term goals': ['session focus', 'interventions', 'progress'],
      'interventions': ['session focus', 'symptoms', 'short-term goals', 'progress'],
      'progress': ['symptoms', 'short-term goals', 'interventions']
    };

    return relationships[categoryName] || [];
  };

  // Auto-suggest connections using pattern-based matching + keyword fallback
  useEffect(() => {
    if (!formData.title) {
      setSuggestedConnections([]);
      return;
    }

    // Step 1: Try pattern-based matching (HIGHEST PRIORITY)
    const currentPattern = parseLibraryPattern(formData.title);
    
    if (currentPattern) {
      // Pattern detected! Find all entries in same pathway
      const patternMatches = allEntries
        .filter(existing => {
          if (existing.id === entry?.id) return false; // Don't suggest self
          
          const existingPattern = parseLibraryPattern(existing.title);
          if (!existingPattern) return false;
          
          // Same condition and pathway number
          return existingPattern.condition === currentPattern.condition &&
                 existingPattern.pathway === currentPattern.pathway;
        })
        .map(e => ({ 
          ...e, 
          confidence: 100, // Pattern match = 100% confidence
          reason: `Same pathway #${currentPattern.pathway}` 
        }));
      
      if (patternMatches.length > 0) {
        setSuggestedConnections(patternMatches.slice(0, 10));
        return;
      }
    }

    // Step 2: Keyword-based matching (FALLBACK)
    const keywords = [
      ...formData.title.toLowerCase().split(' '),
      ...formData.tags.toLowerCase().split(',').map(t => t.trim())
    ].filter(k => k.length > 2);

    if (keywords.length === 0) {
      setSuggestedConnections([]);
      return;
    }

    const relatedCategoryNames = getRelatedCategories(formData.categoryId);
    
    const keywordMatches = allEntries
      .filter(existing => {
        if (existing.id === entry?.id) return false;
        if (existing.categoryId === formData.categoryId) return false;
        
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
        confidence: 60, // Keyword match = 60% confidence
        reason: 'Shared keywords' 
      }))
      .slice(0, 5);
    
    setSuggestedConnections(keywordMatches);
  }, [formData.title, formData.tags, formData.categoryId, allEntries, categories, entry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Create the entry with selected connections
    const entryData = {
      ...formData,
      tags: formData.tags.split(",").map(t => t.trim()).filter(t => t.length > 0),
      selectedConnections: selectedConnections.length > 0 ? selectedConnections : undefined,
    };
    
    onSubmit(entryData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          required
        />
      </div>
      <div>
        <Label htmlFor="content">Content</Label>
        <Textarea
          id="content"
          value={formData.content}
          onChange={(e) => setFormData({ ...formData, content: e.target.value })}
          rows={6}
          required
        />
      </div>
      <div>
        <Label htmlFor="categoryId">Category</Label>
        <Select
          value={formData.categoryId.toString()}
          onValueChange={(value) => setFormData({ ...formData, categoryId: parseInt(value) })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map(cat => (
              <SelectItem key={cat.id} value={cat.id.toString()}>
                {"—".repeat(cat.level)} {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="tags">Tags (comma-separated)</Label>
        <Input
          id="tags"
          value={formData.tags}
          onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
          placeholder="therapy, anxiety, CBT, etc."
        />
      </div>
      <div>
        <Label htmlFor="sortOrder">Sort Order</Label>
        <Input
          id="sortOrder"
          type="number"
          value={formData.sortOrder}
          onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
        />
      </div>
      {/* Auto-suggested Connections */}
      {suggestedConnections.length > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-green-900 dark:text-green-100">
              🔗 Smart Connect Suggestions
            </h4>
            {(suggestedConnections[0] as any)?.confidence === 100 && (
              <Badge className="bg-green-600 text-white">Pattern Match</Badge>
            )}
          </div>
          <p className="text-sm text-green-800 dark:text-green-200 mb-3">
            {(suggestedConnections[0] as any)?.confidence === 100 
              ? `Found ${suggestedConnections.length} entries in the same treatment pathway. Select to auto-connect:`
              : `These entries share keywords with "${formData.title}". Select to connect:`
            }
          </p>
          <div className="space-y-2">
            {suggestedConnections.map(suggestion => {
              const suggestionPattern = parseLibraryPattern(suggestion.title);
              const currentPattern = parseLibraryPattern(formData.title);
              
              return (
                <label key={suggestion.id} className="flex items-center gap-3 p-2 bg-white dark:bg-gray-800 rounded border hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedConnections.includes(suggestion.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedConnections([...selectedConnections, suggestion.id]);
                      } else {
                        setSelectedConnections(selectedConnections.filter(id => id !== suggestion.id));
                      }
                    }}
                    className="rounded"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {categories.find(c => c.id === suggestion.categoryId)?.name}
                      </Badge>
                      <span className="font-medium">{suggestion.title}</span>
                      {(suggestion as any).confidence === 100 && suggestionPattern && currentPattern && (
                        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          {getConnectionType(currentPattern.type, suggestionPattern.type)}
                        </Badge>
                      )}
                      {(suggestion as any).confidence && (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                          {(suggestion as any).confidence}%
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {suggestion.content.substring(0, 80)}...
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
          {selectedConnections.length > 0 && (
            <p className="text-sm text-green-700 dark:text-green-300 mt-2">
              ✓ {selectedConnections.length} connection(s) will be created automatically
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving..." : entry ? "Update" : "Create"}
          {!entry && selectedConnections.length > 0 && (
            <span className="ml-1">+ {selectedConnections.length} connections</span>
          )}
        </Button>
      </div>
    </form>
  );
}

// Connection Form Component
function ConnectionForm({
  sourceEntry,
  allEntries,
  categories,
  onConnectionCreated
}: {
  sourceEntry: LibraryEntryWithDetails;
  allEntries: LibraryEntryWithDetails[];
  categories: LibraryCategoryWithChildren[];
  onConnectionCreated: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTargetIds, setSelectedTargetIds] = useState<number[]>([]);
  const [allSelectedConnections, setAllSelectedConnections] = useState<Array<{categoryId: number, targetIds: number[]}>>([]);
  const [connectionStrength, setConnectionStrength] = useState<number>(5);
  const [isLoading, setIsLoading] = useState(false);

  const { toast } = useToast();
  
  // Get available categories (excluding source category) for the wizard steps
  const availableCategories = categories.filter(cat => cat.id !== sourceEntry.categoryId);
  const currentCategory = availableCategories[currentStep];

  // Get available target entries for current step's category
  const availableTargets = currentCategory ? allEntries.filter(entry => 
    entry.id !== sourceEntry.id && 
    entry.categoryId === currentCategory.id
  ) : [];

  // Restore selections when returning to a previously visited category
  useEffect(() => {
    if (currentCategory) {
      const savedSelection = allSelectedConnections.find(c => c.categoryId === currentCategory.id);
      if (savedSelection) {
        setSelectedTargetIds(savedSelection.targetIds);
      } else {
        setSelectedTargetIds([]);
      }
    }
  }, [currentStep, currentCategory]);

  // Toggle selection
  const toggleTargetSelection = (targetId: number) => {
    setSelectedTargetIds(prev => 
      prev.includes(targetId) 
        ? prev.filter(id => id !== targetId)
        : [...prev, targetId]
    );
  };

  // Select all in current step
  const selectAll = () => {
    setSelectedTargetIds(availableTargets.map(e => e.id));
  };

  // Clear all selections in current step
  const clearAll = () => {
    setSelectedTargetIds([]);
  };

  // Move to next step and save current selections
  const handleNextStep = () => {
    if (currentCategory) {
      if (selectedTargetIds.length > 0) {
        // Save selections for current category
        setAllSelectedConnections(prev => [
          ...prev.filter(c => c.categoryId !== currentCategory.id),
          { categoryId: currentCategory.id, targetIds: selectedTargetIds }
        ]);
      } else {
        // Remove empty selections for current category
        setAllSelectedConnections(prev => prev.filter(c => c.categoryId !== currentCategory.id));
      }
    }
    // Move to next step (allow reaching summary at availableCategories.length)
    setCurrentStep(prev => prev + 1);
  };

  // Go back to previous step
  const handlePreviousStep = () => {
    setCurrentStep(prev => Math.max(0, prev - 1));
  };

  // Skip current category
  const handleSkipStep = () => {
    if (currentCategory) {
      // Remove any selections for this category when skipping
      setAllSelectedConnections(prev => prev.filter(c => c.categoryId !== currentCategory.id));
    }
    // Move to next step (allow reaching summary)
    setCurrentStep(prev => prev + 1);
  };

  // Final submission - create all connections
  const handleCreateConnections = async () => {
    // Include current step selections
    let finalConnections = [...allSelectedConnections];
    if (currentCategory && selectedTargetIds.length > 0) {
      finalConnections = [
        ...finalConnections.filter(c => c.categoryId !== currentCategory.id),
        { categoryId: currentCategory.id, targetIds: selectedTargetIds }
      ];
    }

    const totalConnectionCount = finalConnections.reduce((sum, c) => sum + c.targetIds.length, 0);
    if (totalConnectionCount === 0) {
      toast({ title: "No connections selected", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      // Create all connections in parallel
      const allConnectionPromises = finalConnections.flatMap(({ targetIds }) =>
        targetIds.map(targetId => {
          const connectionData = {
            fromEntryId: sourceEntry.id,
            toEntryId: targetId,
            connectionType: "relates_to",
            strength: connectionStrength,
            description: null
          };
          
          return apiRequest("/api/library/connections", "POST", connectionData);
        })
      );

      const results = await Promise.allSettled(allConnectionPromises);
      
      const failedCount = results.filter(r => r.status === 'rejected').length;
      const successCount = results.filter(r => r.status === 'fulfilled').length;

      if (failedCount > 0) {
        toast({ 
          title: `${successCount} connections created, ${failedCount} failed`, 
          variant: "destructive" 
        });
      } else {
        toast({ title: `${totalConnectionCount} connections created successfully` });
      }
      
      setSelectedTargetIds([]);
      setAllSelectedConnections([]);
      setCurrentStep(0);
      onConnectionCreated();
    } catch (error) {
      toast({ title: "Failed to create connections", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Source Entry Info */}
      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
        <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
          Connecting from: {sourceEntry.title}
        </h3>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">{sourceEntry.category.name}</Badge>
          {sourceEntry.tags && sourceEntry.tags.length > 0 && (
            <div className="flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {sourceEntry.tags.slice(0, 2).map((tag, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {sourceEntry.tags.length > 2 && (
                <span className="text-xs text-gray-500">+{sourceEntry.tags.length - 2}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-300">
            Step {currentStep + 1} of {availableCategories.length}
          </span>
          <span className="text-gray-500">
            {allSelectedConnections.reduce((sum, c) => sum + c.targetIds.length, 0)} connections selected
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div 
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentStep + 1) / availableCategories.length) * 100}%` }}
          />
        </div>
      </div>

      {currentCategory ? (
        <div className="space-y-4">
          {/* Current Step Header */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 p-4 rounded-lg border-2 border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-blue-900 dark:text-blue-100">
                {currentCategory.name}
              </h3>
              <Badge variant="secondary">Step {currentStep + 1}</Badge>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Select entries from {currentCategory.name} to connect with "{sourceEntry.title}"
            </p>
          </div>

        {/* Connection Strength Control */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="connectionStrength">Connection Strength</Label>
            <Badge variant="secondary">{connectionStrength}/10</Badge>
          </div>
          <Select
            value={connectionStrength.toString()}
            onValueChange={(value) => setConnectionStrength(parseInt(value))}
          >
            <SelectTrigger data-testid="select-connection-strength">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 - Very Weak</SelectItem>
              <SelectItem value="2">2 - Weak</SelectItem>
              <SelectItem value="3">3 - Below Average</SelectItem>
              <SelectItem value="4">4 - Slightly Below Average</SelectItem>
              <SelectItem value="5">5 - Moderate (Default)</SelectItem>
              <SelectItem value="6">6 - Slightly Above Average</SelectItem>
              <SelectItem value="7">7 - Above Average</SelectItem>
              <SelectItem value="8">8 - Strong</SelectItem>
              <SelectItem value="9">9 - Very Strong</SelectItem>
              <SelectItem value="10">10 - Extremely Strong</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Set how strongly these entries relate to "{sourceEntry.title}". All selected connections will use this strength.
          </p>
        </div>

        {/* Bulk Selection Actions */}
        {availableTargets.length > 0 && (
          <div className="flex items-center justify-between">
            <Label>Select entries to connect ({selectedTargetIds.length} selected)</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectAll}
                disabled={selectedTargetIds.length === availableTargets.length}
                data-testid="button-select-all"
              >
                Select All ({availableTargets.length})
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearAll}
                disabled={selectedTargetIds.length === 0}
                data-testid="button-clear-all"
              >
                Clear All
              </Button>
            </div>
          </div>
        )}

        {/* Target Entry Selection with Checkboxes */}
        <ScrollArea className="h-[300px] border rounded-lg p-4">
          {availableTargets.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No entries available in {currentCategory.name} for connection.
            </p>
          )}
          
          <div className="space-y-2">
            {availableTargets.map(entry => (
              <label
                key={entry.id}
                className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                data-testid={`checkbox-entry-${entry.id}`}
              >
                <input
                  type="checkbox"
                  checked={selectedTargetIds.includes(entry.id)}
                  onChange={() => toggleTargetSelection(entry.id)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs">
                      {entry.category.name}
                    </Badge>
                    <span className="font-medium">{entry.title}</span>
                  </div>
                  {entry.content && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                      {entry.content}
                    </p>
                  )}
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <Tag className="w-3 h-3" />
                      {entry.tags.slice(0, 2).map((tag, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {entry.tags.length > 2 && (
                        <span className="text-xs text-gray-500">+{entry.tags.length - 2}</span>
                      )}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </ScrollArea>

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handlePreviousStep}
              disabled={currentStep === 0}
            >
              ← Previous
            </Button>
            
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleSkipStep}
                disabled={currentStep >= availableCategories.length - 1}
              >
                Skip
              </Button>
              
              {currentStep < availableCategories.length - 1 ? (
                <Button
                  type="button"
                  onClick={handleNextStep}
                  variant={selectedTargetIds.length > 0 ? "default" : "outline"}
                >
                  Next →
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleCreateConnections}
                  disabled={isLoading || (allSelectedConnections.length === 0 && selectedTargetIds.length === 0)}
                  data-testid="button-create-connections"
                >
                  {isLoading 
                    ? "Creating..." 
                    : `Finish & Create Connections`
                  }
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary Screen */}
          <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/20 dark:to-blue-900/20 p-6 rounded-lg border-2 border-green-200 dark:border-green-800">
            <h3 className="font-semibold text-green-900 dark:text-green-100 mb-4 text-center">
              ✓ Review Your Connections
            </h3>
            {allSelectedConnections.length === 0 ? (
              <p className="text-center text-gray-600 dark:text-gray-400">
                No connections selected. Use the Previous button to go back and make selections.
              </p>
            ) : (
              <div className="space-y-3">
                {allSelectedConnections.map(({ categoryId, targetIds }) => {
                  const category = categories.find(c => c.id === categoryId);
                  return (
                    <div key={categoryId} className="bg-white dark:bg-gray-800 p-3 rounded border">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{category?.name}</Badge>
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {targetIds.length} {targetIds.length === 1 ? 'entry' : 'entries'} selected
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handlePreviousStep}
            >
              ← Previous
            </Button>
            <Button
              onClick={handleCreateConnections}
              disabled={isLoading || allSelectedConnections.length === 0}
            >
              {isLoading 
                ? "Creating Connections..." 
                : `Create ${allSelectedConnections.reduce((sum, c) => sum + c.targetIds.length, 0)} Connections`
              }
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
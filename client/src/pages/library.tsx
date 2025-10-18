import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, FolderOpen, FileText, Edit, Trash2, ChevronRight, ChevronDown, Tag, Clock, Link2 } from "lucide-react";
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
    mutationFn: ({ id, data }: { id: number; data: Partial<InsertLibraryEntry> }) =>
      apiRequest(`/api/library/entries/${id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/entries"] });
      setEditingEntry(null);
      toast({ title: "Entry updated successfully" });
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
                    <Button
                      size="sm"
                      onClick={() => setShowAddEntryDialog(true)}
                      className="flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      Add Entry
                    </Button>
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
                        // Get database connections (preferred) or fallback to tag-based
                        const databaseConnections = connectedEntriesMap[entry.id] || [];
                        const tagRelatedEntries = databaseConnections.length === 0 
                          ? displayedEntries.filter(e => 
                              e.id !== entry.id && 
                              e.tags && entry.tags && 
                              e.tags.some(tag => entry.tags?.includes(tag))
                            ).slice(0, 3)
                          : [];
                        
                        const relatedEntries = databaseConnections.length > 0 ? databaseConnections : tagRelatedEntries;

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
                                  
                                  {/* Related Entries Section */}
                                  {relatedEntries.length > 0 && (
                                    <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                                        <Link2 className="w-3 h-3" />
                                        <span className="font-medium">
                                          {databaseConnections.length > 0 ? 'Database Connections:' : 'Tag-Based Connections:'}
                                        </span>
                                        {relatedEntries.map((related, idx) => (
                                          <span key={`${entry.id}-${related.id}-${idx}`} className="text-xs">
                                            <span 
                                              className="text-blue-600 dark:text-blue-400 cursor-pointer hover:underline bg-blue-50 dark:bg-blue-900/20 px-1 py-0.5 rounded"
                                              onClick={() => {
                                                const element = document.querySelector(`[data-entry-id="${related.id}"]`);
                                                element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                              }}
                                              title={databaseConnections.length > 0 ? 'Connected entry' : 'Related by tags'}
                                            >
                                              {related.title}
                                            </span>
                                            {idx < relatedEntries.length - 1 && ", "}
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
          <DialogContent className="max-w-2xl">
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
          <DialogContent className="max-w-2xl">
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
          <DialogContent className="max-w-3xl">
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

  // Auto-suggest connections based on title and tags
  useEffect(() => {
    if (!formData.title && !formData.tags) {
      setSuggestedConnections([]);
      return;
    }

    const keywords = [
      ...formData.title.toLowerCase().split(' '),
      ...formData.tags.toLowerCase().split(',').map(t => t.trim())
    ].filter(k => k.length > 2); // Only meaningful keywords

    const suggestions = allEntries.filter(existing => {
      // Don't suggest entries from same category
      if (existing.categoryId === formData.categoryId) return false;
      
      // Check if entry shares keywords
      const existingKeywords = [
        ...existing.title.toLowerCase().split(' '),
        ...(existing.tags || []).map(t => t.toLowerCase())
      ];
      
      return keywords.some(keyword => 
        existingKeywords.some(existing => 
          existing.includes(keyword) || keyword.includes(existing)
        )
      );
    }).slice(0, 5); // Limit to 5 suggestions
    
    setSuggestedConnections(suggestions);
  }, [formData.title, formData.tags, formData.categoryId, allEntries]);

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
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
          <h4 className="font-medium text-green-900 dark:text-green-100 mb-3">
            🔗 Auto-detected Related Entries
          </h4>
          <p className="text-sm text-green-800 dark:text-green-200 mb-3">
            These entries seem related to "{formData.title}". Select ones to automatically connect:
          </p>
          <div className="space-y-2">
            {suggestedConnections.map(suggestion => (
              <label key={suggestion.id} className="flex items-center gap-3 p-2 bg-white dark:bg-gray-800 rounded border">
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
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {categories.find(c => c.id === suggestion.categoryId)?.name}
                    </Badge>
                    <span className="font-medium">{suggestion.title}</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {suggestion.content.substring(0, 80)}...
                  </p>
                </div>
              </label>
            ))}
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
  const [selectedTargetIds, setSelectedTargetIds] = useState<number[]>([]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { toast } = useToast();

  // Get available target entries (from different categories than source)
  const availableTargets = allEntries.filter(entry => 
    entry.id !== sourceEntry.id && 
    entry.categoryId !== sourceEntry.categoryId &&
    (selectedCategoryFilter === null || entry.categoryId === selectedCategoryFilter)
  );

  // Get all main categories for filter dropdown (excluding source category) - from database
  const availableCategories = categories.filter(cat => cat.id !== sourceEntry.categoryId);

  // Toggle selection
  const toggleTargetSelection = (targetId: number) => {
    setSelectedTargetIds(prev => 
      prev.includes(targetId) 
        ? prev.filter(id => id !== targetId)
        : [...prev, targetId]
    );
  };

  // Select all in current filter
  const selectAll = () => {
    setSelectedTargetIds(availableTargets.map(e => e.id));
  };

  // Clear all selections
  const clearAll = () => {
    setSelectedTargetIds([]);
  };

  const handleCreateConnections = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTargetIds.length === 0) return;

    setIsLoading(true);
    try {
      // Create all connections in parallel
      const connectionPromises = selectedTargetIds.map(targetId => 
        fetch("/api/library/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromEntryId: sourceEntry.id,
            toEntryId: targetId,
            connectionType: "relates_to",
            strength: 5,
            description: null
          })
        })
      );

      const results = await Promise.all(connectionPromises);
      const failedCount = results.filter(r => !r.ok).length;

      if (failedCount > 0) {
        toast({ 
          title: `${selectedTargetIds.length - failedCount} connections created, ${failedCount} failed`, 
          variant: "destructive" 
        });
      } else {
        toast({ title: `${selectedTargetIds.length} connections created successfully` });
      }
      
      setSelectedTargetIds([]);
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
              {sourceEntry.tags.slice(0, 3).map((tag, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleCreateConnections} className="space-y-4">
        {/* Category Filter */}
        <div>
          <Label htmlFor="categoryFilter">Filter by Category (optional)</Label>
          <Select
            value={selectedCategoryFilter?.toString() || "all"}
            onValueChange={(value) => {
              setSelectedCategoryFilter(value === "all" ? null : parseInt(value));
              setSelectedTargetIds([]); // Reset selection when filter changes
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {availableCategories.map(category => (
                <SelectItem key={category.id} value={category.id.toString()}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          {availableTargets.length === 0 && selectedCategoryFilter !== null && (
            <p className="text-sm text-gray-500 text-center py-8">
              No entries in this category available for connection.
            </p>
          )}
          {availableTargets.length === 0 && selectedCategoryFilter === null && (
            <p className="text-sm text-gray-500 text-center py-8">
              No entries from different categories available for connection.
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
                  {entry.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                      {entry.description}
                    </p>
                  )}
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <Tag className="w-3 h-3" />
                      {entry.tags.slice(0, 3).map((tag, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2">
          <Button 
            type="submit" 
            disabled={isLoading || selectedTargetIds.length === 0}
            data-testid="button-create-connections"
          >
            {isLoading 
              ? "Creating Connections..." 
              : `Create ${selectedTargetIds.length} Connection${selectedTargetIds.length !== 1 ? 's' : ''}`
            }
          </Button>
        </div>
      </form>

      {/* Example of how this helps */}
      {selectedTargetIds.length > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
          <h4 className="font-medium text-green-900 dark:text-green-100 mb-2">
            How this helps in session notes:
          </h4>
          <p className="text-sm text-green-800 dark:text-green-200">
            When you select "{sourceEntry.title}" in session notes, the system will automatically 
            suggest these {selectedTargetIds.length} related option{selectedTargetIds.length !== 1 ? 's' : ''}.
          </p>
        </div>
      )}
    </div>
  );
}
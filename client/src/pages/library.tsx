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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [showAddEntryDialog, setShowAddEntryDialog] = useState(false);
  const [editingCategory, setEditingCategory] = useState<LibraryCategoryWithChildren | null>(null);
  const [editingEntry, setEditingEntry] = useState<LibraryEntryWithDetails | null>(null);
  const [connectedEntriesMap, setConnectedEntriesMap] = useState<Record<number, any[]>>({});
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Fetch categories
  const { data: categories = [], isLoading: loadingCategories } = useQuery<LibraryCategoryWithChildren[]>({
    queryKey: ["/api/library/categories"],
    queryFn: async () => {
      const response = await fetch("/api/library/categories");
      if (!response.ok) throw new Error("Failed to fetch categories");
      return response.json();
    },
  });

  // Fetch entries for selected category
  const { data: entries = [], isLoading: loadingEntries } = useQuery<LibraryEntryWithDetails[]>({
    queryKey: ["/api/library/entries", selectedCategory],
    queryFn: async () => {
      const url = selectedCategory ? `/api/library/entries?categoryId=${selectedCategory}` : "/api/library/entries";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch entries");
      return response.json();
    },
  });

  // Search entries
  const { data: searchResults = [], isLoading: searching } = useQuery<LibraryEntryWithDetails[]>({
    queryKey: ["/api/library/search", debouncedSearchQuery, selectedCategory],
    queryFn: async () => {
      if (!debouncedSearchQuery.trim()) return [];
      const url = selectedCategory 
        ? `/api/library/search?q=${encodeURIComponent(debouncedSearchQuery)}&categoryId=${selectedCategory}`
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
    mutationFn: (data: InsertLibraryEntry) => apiRequest("/api/library/entries", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/entries"] });
      setShowAddEntryDialog(false);
      toast({ title: "Entry created successfully" });
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

  // Helper functions
  const toggleCategoryExpansion = (categoryId: number) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

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

  const renderCategoryTree = (cats: LibraryCategoryWithChildren[], level = 0) => {
    return cats.map((category) => (
      <div key={category.id} className={`ml-${level * 4}`}>
        <div 
          className={`flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${
            selectedCategory === category.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
          }`}
          onClick={() => setSelectedCategory(category.id)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleCategoryExpansion(category.id);
            }}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
          >
            {category.children && category.children.length > 0 ? (
              expandedCategories.has(category.id) ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )
            ) : (
              <div className="w-4 h-4" />
            )}
          </button>
          <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="flex-1 text-sm font-medium">{category.name}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setEditingCategory(category);
              }}
            >
              <Edit className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                deleteCategoryMutation.mutate(category.id);
              }}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
        {category.children && expandedCategories.has(category.id) && (
          <div className="ml-4">
            {renderCategoryTree(category.children, level + 1)}
          </div>
        )}
      </div>
    ));
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
          console.error(`Failed to fetch connections for entry ${id}:`, error);
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
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Clinical Content Library</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Organize and access reusable clinical content for session notes
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Categories Sidebar */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Categories</CardTitle>
                  <Button
                    size="sm"
                    onClick={() => setShowAddCategoryDialog(true)}
                    className="flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add Category
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[600px]">
                  <div className="space-y-1">
                    <div
                      className={`flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${
                        selectedCategory === null ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                      onClick={() => setSelectedCategory(null)}
                    >
                      <FileText className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                      <span className="text-sm font-medium">All Entries</span>
                    </div>
                    {loadingCategories ? (
                      <div className="p-4 text-center text-gray-500">Loading categories...</div>
                    ) : (
                      renderCategoryTree(categories)
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    {selectedCategory ? 
                      categories.find(c => c.id === selectedCategory)?.name || 'Category' : 
                      'All Entries'
                    }
                  </CardTitle>
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
                      placeholder="Search entries..."
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
                              e.tags.some(tag => entry.tags.includes(tag))
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
                                          <span key={related.id} className="text-xs">
                                            <span 
                                              className="text-blue-600 dark:text-blue-400 cursor-pointer hover:underline bg-blue-50 dark:bg-blue-900/20 px-1 py-0.5 rounded"
                                              onClick={() => {
                                                const element = document.querySelector(`[data-entry-id="${related.id}"]`);
                                                element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                              }}
                                              title={databaseConnections.length > 0 ? `${related.connectionType} (strength: ${related.connectionStrength})` : 'Related by tags'}
                                            >
                                              {related.title}
                                              {databaseConnections.length > 0 && (
                                                <Badge variant="outline" className="ml-1 text-xs">
                                                  {related.connectionType}
                                                </Badge>
                                              )}
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
          </div>
        </div>

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
              onSubmit={(data) => createEntryMutation.mutate(data)}
              categories={getAllCategories(categories)}
              selectedCategoryId={selectedCategory}
              isLoading={createEntryMutation.isPending}
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
  isLoading 
}: { 
  entry?: LibraryEntryWithDetails;
  onSubmit: (data: InsertLibraryEntry) => void;
  categories: Array<LibraryCategoryWithChildren & { level: number }>;
  selectedCategoryId?: number | null;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    title: entry?.title || "",
    content: entry?.content || "",
    categoryId: entry?.categoryId || selectedCategoryId || (categories[0]?.id || 0),
    tags: entry?.tags?.join(", ") || "",
    sortOrder: entry?.sortOrder || 0,
    createdById: entry?.createdById || 1, // TODO: Get from auth context
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      tags: formData.tags.split(",").map(t => t.trim()).filter(t => t.length > 0),
    });
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
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving..." : entry ? "Update" : "Create"}
        </Button>
      </div>
    </form>
  );
}
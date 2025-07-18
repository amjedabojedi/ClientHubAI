import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Edit2, Trash2, Save, X, Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface OptionCategory {
  id: number;
  categoryKey: string;
  categoryName: string;
  description?: string;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  options?: SystemOption[];
}

interface SystemOption {
  id: number;
  categoryId: number;
  optionKey: string;
  optionLabel: string;
  sortOrder: number;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category?: OptionCategory;
}

interface CategoryWithOptions extends OptionCategory {
  options: SystemOption[];
}

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [editingCategory, setEditingCategory] = useState<OptionCategory | null>(null);
  const [editingOption, setEditingOption] = useState<SystemOption | null>(null);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [isAddingOption, setIsAddingOption] = useState(false);

  // Fetch categories
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["/api/system-options/categories"],
  });

  // Fetch category with options when selected
  const { data: selectedCategory, isLoading: categoryLoading } = useQuery({
    queryKey: ["/api/system-options/categories", selectedCategoryId],
    enabled: !!selectedCategoryId,
  });

  // Mutations
  const createCategoryMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/system-options/categories", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories"] });
      setIsAddingCategory(false);
      toast({ title: "Category created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create category", variant: "destructive" });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/system-options/categories/${id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories"] });
      setEditingCategory(null);
      toast({ title: "Category updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update category", variant: "destructive" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/system-options/categories/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories"] });
      setSelectedCategoryId(null);
      toast({ title: "Category deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete category", variant: "destructive" });
    },
  });

  const createOptionMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/system-options", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories", selectedCategoryId] });
      setIsAddingOption(false);
      toast({ title: "Option created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create option", variant: "destructive" });
    },
  });

  const updateOptionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/system-options/${id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories", selectedCategoryId] });
      setEditingOption(null);
      toast({ title: "Option updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update option", variant: "destructive" });
    },
  });

  const deleteOptionMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/system-options/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories", selectedCategoryId] });
      toast({ title: "Option deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete option", variant: "destructive" });
    },
  });

  // Form handlers
  const handleCreateCategory = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      categoryKey: formData.get("categoryKey") as string,
      categoryName: formData.get("categoryName") as string,
      description: formData.get("description") as string,
      isSystem: false,
      isActive: true,
    };
    createCategoryMutation.mutate(data);
  };

  const handleUpdateCategory = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingCategory) return;
    
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      categoryName: formData.get("categoryName") as string,
      description: formData.get("description") as string,
      isActive: formData.get("isActive") === "true",
    };
    updateCategoryMutation.mutate({ id: editingCategory.id, data });
  };

  const handleCreateOption = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedCategoryId) return;
    
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      categoryId: selectedCategoryId,
      optionKey: formData.get("optionKey") as string,
      optionLabel: formData.get("optionLabel") as string,
      sortOrder: parseInt(formData.get("sortOrder") as string) || 0,
      isDefault: formData.get("isDefault") === "true",
      isSystem: false,
      isActive: true,
    };
    createOptionMutation.mutate(data);
  };

  const handleUpdateOption = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingOption) return;
    
    const formData = new FormData(e.target as HTMLFormElement);
    const data = {
      optionLabel: formData.get("optionLabel") as string,
      sortOrder: parseInt(formData.get("sortOrder") as string) || 0,
      isDefault: formData.get("isDefault") === "true",
      isActive: formData.get("isActive") === "true",
    };
    updateOptionMutation.mutate({ id: editingOption.id, data });
  };

  if (categoriesLoading) {
    return (
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-center min-h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-300">Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Settings className="w-6 h-6" />
            System Settings
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Manage dropdown options and system configuration
          </p>
        </div>
        <Button onClick={() => setIsAddingCategory(true)} className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Category
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Categories List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Option Categories</CardTitle>
            <CardDescription>
              Select a category to manage its options
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {categories.map((category: OptionCategory) => (
              <div
                key={category.id}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedCategoryId === category.id
                    ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => setSelectedCategoryId(category.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      {category.categoryName}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {category.categoryKey}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {category.isSystem && (
                      <Badge variant="secondary" className="text-xs">System</Badge>
                    )}
                    {!category.isActive && (
                      <Badge variant="destructive" className="text-xs">Inactive</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCategory(category);
                      }}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    {!category.isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Are you sure you want to delete this category?")) {
                            deleteCategoryMutation.mutate(category.id);
                          }
                        }}
                      >
                        <Trash2 className="w-3 h-3 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Options Management */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {selectedCategory ? `${selectedCategory.categoryName} Options` : "Select Category"}
                </CardTitle>
                <CardDescription>
                  {selectedCategory ? selectedCategory.description || "Manage options for this category" : "Choose a category to view and manage its options"}
                </CardDescription>
              </div>
              {selectedCategory && (
                <Button onClick={() => setIsAddingOption(true)} size="sm" className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add Option
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedCategory ? (
              <div className="text-center py-12">
                <Settings className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Select a category to manage its options</p>
              </div>
            ) : categoryLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-300">Loading options...</p>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedCategory.options?.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400">No options configured for this category</p>
                  </div>
                ) : (
                  selectedCategory.options?.map((option: SystemOption) => (
                    <div
                      key={option.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div>
                        <h4 className="font-medium text-gray-900 dark:text-white">
                          {option.optionLabel}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Key: {option.optionKey} • Order: {option.sortOrder}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {option.isDefault && (
                          <Badge variant="default" className="text-xs">Default</Badge>
                        )}
                        {option.isSystem && (
                          <Badge variant="secondary" className="text-xs">System</Badge>
                        )}
                        {!option.isActive && (
                          <Badge variant="destructive" className="text-xs">Inactive</Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingOption(option)}
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        {!option.isSystem && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm("Are you sure you want to delete this option?")) {
                                deleteOptionMutation.mutate(option.id);
                              }
                            }}
                          >
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Category Dialog */}
      <Dialog open={isAddingCategory} onOpenChange={setIsAddingCategory}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Category</DialogTitle>
            <DialogDescription>
              Create a new option category for dropdown selections
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCategory} className="space-y-4">
            <div>
              <Label htmlFor="categoryKey">Category Key</Label>
              <Input
                id="categoryKey"
                name="categoryKey"
                placeholder="e.g., therapy_types"
                required
              />
              <p className="text-sm text-gray-500 mt-1">
                Unique identifier (lowercase, underscores only)
              </p>
            </div>
            <div>
              <Label htmlFor="categoryName">Category Name</Label>
              <Input
                id="categoryName"
                name="categoryName"
                placeholder="e.g., Therapy Types"
                required
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                placeholder="Brief description of this category"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsAddingCategory(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createCategoryMutation.isPending}>
                {createCategoryMutation.isPending ? "Creating..." : "Create Category"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog open={!!editingCategory} onOpenChange={() => setEditingCategory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>
              Update category information
            </DialogDescription>
          </DialogHeader>
          {editingCategory && (
            <form onSubmit={handleUpdateCategory} className="space-y-4">
              <div>
                <Label htmlFor="edit-categoryName">Category Name</Label>
                <Input
                  id="edit-categoryName"
                  name="categoryName"
                  defaultValue={editingCategory.categoryName}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-description">Description</Label>
                <Input
                  id="edit-description"
                  name="description"
                  defaultValue={editingCategory.description || ""}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit-isActive"
                  name="isActive"
                  defaultChecked={editingCategory.isActive}
                />
                <Label htmlFor="edit-isActive">Active</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingCategory(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateCategoryMutation.isPending}>
                  {updateCategoryMutation.isPending ? "Updating..." : "Update Category"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Option Dialog */}
      <Dialog open={isAddingOption} onOpenChange={setIsAddingOption}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Option</DialogTitle>
            <DialogDescription>
              Add a new option to {selectedCategory?.categoryName}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateOption} className="space-y-4">
            <div>
              <Label htmlFor="optionKey">Option Key</Label>
              <Input
                id="optionKey"
                name="optionKey"
                placeholder="e.g., cbt"
                required
              />
              <p className="text-sm text-gray-500 mt-1">
                Unique identifier (lowercase, underscores only)
              </p>
            </div>
            <div>
              <Label htmlFor="optionLabel">Option Label</Label>
              <Input
                id="optionLabel"
                name="optionLabel"
                placeholder="e.g., Cognitive Behavioral Therapy"
                required
              />
            </div>
            <div>
              <Label htmlFor="sortOrder">Sort Order</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                defaultValue="0"
                placeholder="0"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="isDefault" name="isDefault" />
              <Label htmlFor="isDefault">Default Selection</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsAddingOption(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createOptionMutation.isPending}>
                {createOptionMutation.isPending ? "Creating..." : "Create Option"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Option Dialog */}
      <Dialog open={!!editingOption} onOpenChange={() => setEditingOption(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Option</DialogTitle>
            <DialogDescription>
              Update option information
            </DialogDescription>
          </DialogHeader>
          {editingOption && (
            <form onSubmit={handleUpdateOption} className="space-y-4">
              <div>
                <Label htmlFor="edit-optionLabel">Option Label</Label>
                <Input
                  id="edit-optionLabel"
                  name="optionLabel"
                  defaultValue={editingOption.optionLabel}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-sortOrder">Sort Order</Label>
                <Input
                  id="edit-sortOrder"
                  name="sortOrder"
                  type="number"
                  defaultValue={editingOption.sortOrder}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit-isDefault"
                  name="isDefault"
                  defaultChecked={editingOption.isDefault}
                />
                <Label htmlFor="edit-isDefault">Default Selection</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit-isActive"
                  name="isActive"
                  defaultChecked={editingOption.isActive}
                />
                <Label htmlFor="edit-isActive">Active</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingOption(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateOptionMutation.isPending}>
                  {updateOptionMutation.isPending ? "Updating..." : "Update Option"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
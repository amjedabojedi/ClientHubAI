import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Edit2, Trash2, Save, X, Settings, DollarSign, MapPin } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";
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
  const [activeTab, setActiveTab] = useState("system-options");
  const [editingServiceCode, setEditingServiceCode] = useState<any | null>(null);
  const [editingRoom, setEditingRoom] = useState<any | null>(null);

  // Fetch categories
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["/api/system-options/categories"],
  });

  // Fetch service codes from Services table
  const { data: serviceCodes = [], isLoading: serviceCodesLoading, refetch: refetchServiceCodes } = useQuery({
    queryKey: ["/api/services"],
    queryFn: () => fetch("/api/services").then(res => res.json()).then(data => {
      return data.map((service: any) => ({
        id: service.id,
        optionKey: service.serviceCode,
        optionLabel: service.serviceName,
        price: service.baseRate
      }));
    }),
    staleTime: 0, // Always refetch when needed
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
  });

  // Fetch rooms
  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ["/api/rooms"],
  }) as { data: any[], isLoading: boolean };

  // Fetch category with options when selected
  const { data: selectedCategory, isLoading: categoryLoading, error: categoryError } = useQuery({
    queryKey: ["/api/system-options/categories", selectedCategoryId],
    enabled: !!selectedCategoryId,
    queryFn: () => selectedCategoryId ? fetch(`/api/system-options/categories/${selectedCategoryId}`).then(res => res.json()) : null,
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
    onSuccess: async () => {
      // Invalidate and refetch the specific category query first to ensure UI updates
      await queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories", selectedCategoryId] });
      // Then invalidate the general categories query
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories"] });
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
    onSuccess: async () => {
      // Invalidate and refetch the specific category query first to ensure UI updates
      await queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories", selectedCategoryId] });
      // Then invalidate the general categories query
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories"] });
      setEditingOption(null);
      toast({ title: "Option updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update option", variant: "destructive" });
    },
  });

  const deleteOptionMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/system-options/${id}`, "DELETE"),
    onSuccess: async () => {
      // Invalidate and refetch the specific category query first to ensure UI updates
      await queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories", selectedCategoryId] });
      // Then invalidate the general categories query
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories"] });
      toast({ title: "Option deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete option", variant: "destructive" });
    },
  });

  // Service management mutations
  const updateServiceCodeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/services/${id}`, "PUT", data),
    onSuccess: async () => {
      // Force refetch the service codes data
      await queryClient.refetchQueries({ queryKey: ["/api/services"] });
      setEditingServiceCode(null);
      toast({ title: "Service code updated successfully" });
    },
    onError: (error: any) => {
      // Service code update error handled by toast
      toast({ title: "Failed to update service code", variant: "destructive" });
    },
  });

  const deleteServiceCodeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/services/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      toast({ title: "Service code deleted successfully" });
    },
    onError: (error: any) => {
      // Service code deletion error handled by toast
      
      // Show specific error message if available
      let errorMessage = "Failed to delete service code";
      if (error?.message?.includes("sessions are using")) {
        errorMessage = "Cannot delete: Service is used in existing sessions";
      } else if (error?.message?.includes("billing records are using")) {
        errorMessage = "Cannot delete: Service is used in billing records";
      }
      
      toast({ title: errorMessage, variant: "destructive" });
    },
  });

  const createServiceCodeMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/services", "POST", {
      serviceCode: data.optionKey,
      serviceName: data.optionLabel,
      baseRate: data.price,
      duration: 60,
      category: 'Therapy',
      isActive: true
    }),
    onSuccess: async () => {
      // Force refetch the service codes data
      await queryClient.refetchQueries({ queryKey: ["/api/services"] });
      setEditingServiceCode(null);
      toast({ title: "Service code created successfully" });
    },
    onError: (error: any) => {
      // Service code creation error handled by toast
      toast({ title: "Failed to create service code", variant: "destructive" });
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
    
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    
    // Get switch values directly from the form elements since FormData doesn't handle switches properly
    const isDefaultSwitch = form.querySelector('input[name="isDefault"]') as HTMLInputElement;
    const isActiveSwitch = form.querySelector('input[name="isActive"]') as HTMLInputElement;
    
    const newOptionKey = formData.get("optionKey") as string;
    const oldOptionKey = editingOption.optionKey;
    
    const data = {
      optionKey: newOptionKey,
      optionLabel: formData.get("optionLabel") as string,
      sortOrder: parseInt(formData.get("sortOrder") as string) || 0,
      isDefault: isDefaultSwitch?.checked || false,
      isActive: isActiveSwitch?.checked || false,
      oldOptionKey: oldOptionKey // Include the old key for data migration
    };
    
    updateOptionMutation.mutate({ id: editingOption.id, data });
  };

  const handleUpdateServiceCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const priceValue = formData.get("price") as string;
    const serviceNameValue = formData.get("optionLabel") as string;
    const serviceCodeValue = formData.get("optionKey") as string;
    const data = {
      serviceCode: serviceCodeValue,
      baseRate: parseFloat(priceValue).toFixed(2), // Use baseRate to match API
      serviceName: serviceNameValue // Use serviceName to match API
    };

    updateServiceCodeMutation.mutate({ id: editingServiceCode.id, data });
  };

  const handleCreateServiceCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const priceValue = formData.get("price") as string;
    const data = {
      categoryId: 32, // Service codes category
      optionKey: formData.get("optionKey") as string,
      optionLabel: formData.get("optionLabel") as string,
      price: parseFloat(priceValue).toFixed(2),
      sortOrder: 1,
      isDefault: false,
      isActive: true,
    };

    createServiceCodeMutation.mutate(data);
  };

  const createRoomMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/rooms", "POST", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      setEditingRoom(null);
      toast({ title: "Room created successfully" });
    },
    onError: (error: any) => {
      // Room creation error handled by toast
      toast({ title: "Failed to create room", variant: "destructive" });
    },
  });

  const updateRoomMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/rooms/${id}`, "PUT", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      setEditingRoom(null);
      toast({ title: "Room updated successfully" });
    },
    onError: (error: any) => {
      // Room update error handled by toast
      toast({ title: "Failed to update room", variant: "destructive" });
    },
  });

  const deleteRoomMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/rooms/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      toast({ title: "Room deleted successfully" });
    },
    onError: (error: any) => {
      // Room deletion error handled by toast
      toast({ title: "Failed to delete room", variant: "destructive" });
    },
  });

  const handleCreateRoom = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      roomNumber: formData.get("roomNumber") as string,
      roomName: formData.get("roomName") as string,
      capacity: parseInt(formData.get("capacity") as string) || 1,
      isActive: true,
    };
    createRoomMutation.mutate(data);
  };

  const handleUpdateRoom = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      roomNumber: formData.get("roomNumber") as string,
      roomName: formData.get("roomName") as string,
      capacity: parseInt(formData.get("capacity") as string) || 1,
    };
    updateRoomMutation.mutate({ id: editingRoom.id, data });
  };

  if (categoriesLoading || serviceCodesLoading) {
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
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="system-options">System Options</TabsTrigger>
          <TabsTrigger value="service-prices">Service Prices</TabsTrigger>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
        </TabsList>

        <TabsContent value="system-options" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">System Options</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Manage dropdown options and categories
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
            {(categories as OptionCategory[]).map((category: OptionCategory) => (
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
                  {selectedCategory ? `${selectedCategory.categoryName || 'Unknown'} Options` : "Select Category"}
                </CardTitle>
                <CardDescription>
                  {selectedCategory ? (selectedCategory.description || "Manage options for this category") : "Choose a category to view and manage its options"}
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
            ) : categoryError ? (
              <div className="text-center py-8">
                <p className="text-red-500">Error loading options: {categoryError.message}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {!selectedCategory.options || selectedCategory.options.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400">No options configured for this category</p>
                  </div>
                ) : (
                  selectedCategory.options.map((option: SystemOption) => (
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
                <Label htmlFor="edit-optionKey">Option Key</Label>
                <Input
                  id="edit-optionKey"
                  name="optionKey"
                  defaultValue={editingOption.optionKey}
                  required
                />
                <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
                  ⚠️ Changing this will update all existing data that uses this option
                </p>
              </div>
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
        </TabsContent>

        <TabsContent value="service-prices" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Service Prices</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Manage pricing for therapy services
              </p>
            </div>
            <Button onClick={() => setEditingServiceCode({ id: null, optionKey: '', optionLabel: '', price: '0.00' })} className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Service Code
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Service Code Pricing
              </CardTitle>
              <CardDescription>
                Set prices for each service code used in session billing
              </CardDescription>
            </CardHeader>
            <CardContent>
              {serviceCodesLoading && <p>Loading service codes...</p>}
              {!serviceCodesLoading && serviceCodes.length === 0 && <p>No service codes found</p>}
              <div className="space-y-4">
                {serviceCodes.map((serviceCode: any) => (
                  <div key={serviceCode.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900 dark:text-white">
                        {serviceCode.optionKey} - {serviceCode.optionLabel}
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Service Code: {serviceCode.optionKey}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-semibold text-lg">${serviceCode.price || '0.00'}</p>
                        <p className="text-sm text-gray-500">Current Price</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingServiceCode(serviceCode)}
                          className="flex items-center gap-2"
                        >
                          <Edit2 className="w-4 h-4" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete ${serviceCode.optionKey} - ${serviceCode.optionLabel}?`)) {
                              deleteServiceCodeMutation.mutate(serviceCode.id);
                            }
                          }}
                          className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:border-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rooms" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Room Management</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Manage therapy rooms and session locations
              </p>
            </div>
            <Button onClick={() => setEditingRoom({ id: null, roomNumber: '', roomName: '', capacity: 1 })} className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Room
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Therapy Rooms
              </CardTitle>
              <CardDescription>
                Configure rooms available for scheduling sessions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {roomsLoading && <p>Loading rooms...</p>}
              {!roomsLoading && rooms.length === 0 && <p>No rooms found</p>}
              
              {/* Room Table - consistent with other settings */}
              <div className="border rounded-lg">
                <div className="grid grid-cols-5 gap-4 p-3 bg-gray-50 dark:bg-gray-800 font-medium text-sm border-b">
                  <div>Room Number</div>
                  <div>Room Name</div>
                  <div>Capacity</div>
                  <div>Status</div>
                  <div>Actions</div>
                </div>
                {rooms.map((room: any) => (
                  <div key={room.id} className="grid grid-cols-5 gap-4 p-3 border-b last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <div className="font-medium">{room.roomNumber}</div>
                    <div>{room.roomName}</div>
                    <div>{room.capacity}</div>
                    <div>
                      <Badge variant={room.isActive ? "default" : "secondary"}>
                        {room.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingRoom(room)}
                      >
                        <Edit2 className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete Room ${room.roomNumber}?`)) {
                            deleteRoomMutation.mutate(room.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Service Code Edit/Create Dialog */}
      <Dialog open={!!editingServiceCode} onOpenChange={() => setEditingServiceCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingServiceCode?.id ? "Edit Service Code Price" : "Add New Service Code"}
            </DialogTitle>
            <DialogDescription>
              {editingServiceCode?.id 
                ? `Update pricing for ${editingServiceCode?.optionKey} - ${editingServiceCode?.optionLabel}`
                : "Create a new service code with pricing"
              }
            </DialogDescription>
          </DialogHeader>
          {editingServiceCode && (
            <form onSubmit={editingServiceCode.id ? handleUpdateServiceCode : handleCreateServiceCode} className="space-y-4">
              <div>
                <Label htmlFor="edit-optionKey">Service Code</Label>
                <Input
                  id="edit-optionKey"
                  name="optionKey"
                  defaultValue={editingServiceCode.optionKey}
                  placeholder="e.g., 90791"
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-optionLabel">Service Name</Label>
                <Input
                  id="edit-optionLabel"
                  name="optionLabel"
                  defaultValue={editingServiceCode.optionLabel}
                  placeholder="e.g., Diagnostic Interview"
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-price">Price (USD)</Label>
                <Input
                  id="edit-price"
                  name="price"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editingServiceCode.price || '0.00'}
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingServiceCode(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={editingServiceCode.id ? updateServiceCodeMutation.isPending : createServiceCodeMutation.isPending}>
                  {editingServiceCode.id 
                    ? (updateServiceCodeMutation.isPending ? "Updating..." : "Update Price")
                    : (createServiceCodeMutation.isPending ? "Creating..." : "Create Service Code")
                  }
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Room Edit/Create Dialog */}
      <Dialog open={!!editingRoom} onOpenChange={() => setEditingRoom(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingRoom?.id ? "Edit Room" : "Add New Room"}
            </DialogTitle>
            <DialogDescription>
              {editingRoom?.id 
                ? `Update details for Room ${editingRoom?.roomNumber}`
                : "Create a new therapy room"
              }
            </DialogDescription>
          </DialogHeader>
          {editingRoom && (
            <form onSubmit={editingRoom.id ? handleUpdateRoom : handleCreateRoom} className="space-y-4">
              <div>
                <Label htmlFor="room-number">Room Number</Label>
                <Input
                  id="room-number"
                  name="roomNumber"
                  defaultValue={editingRoom.roomNumber}
                  placeholder="e.g., 101"
                  required
                />
              </div>
              <div>
                <Label htmlFor="room-name">Room Name</Label>
                <Input
                  id="room-name"
                  name="roomName"
                  defaultValue={editingRoom.roomName}
                  placeholder="e.g., Consultation Room A"
                  required
                />
              </div>
              <div>
                <Label htmlFor="room-capacity">Capacity</Label>
                <Input
                  id="room-capacity"
                  name="capacity"
                  type="number"
                  min="1"
                  defaultValue={editingRoom.capacity || 1}
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingRoom(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={editingRoom.id ? updateRoomMutation.isPending : createRoomMutation.isPending}>
                  {editingRoom.id 
                    ? (updateRoomMutation.isPending ? "Updating..." : "Update Room")
                    : (createRoomMutation.isPending ? "Creating..." : "Create Room")
                  }
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
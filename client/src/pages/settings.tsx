import { useState, useEffect } from "react";
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
  const [practiceConfig, setPracticeConfig] = useState({
    practiceName: "",
    practiceAddress: "",
    practicePhone: "",
    practiceEmail: "",
    practiceWebsite: "",
    description: "",
    subtitle: ""
  });

  // Fetch practice settings from system options
  const { data: practiceSettings } = useQuery({
    queryKey: ["/api/system-options/categories/practice_settings"],
    queryFn: async () => {
      // Try to find practice_settings category by key
      const categoriesResponse = await fetch("/api/system-options/categories");
      const categoriesData = await categoriesResponse.json();
      const practiceCategory = categoriesData.find((cat: any) => cat.categoryKey === 'practice_settings');
      
      if (!practiceCategory) {
        return {
          practiceName: "Resilience Counseling Research & Consultation",
          practiceAddress: "111 Waterloo St Unit 406, London, ON N6B 2M4",
          practicePhone: "+1 (548)866-0366",
          practiceEmail: "mail@resiliencec.com",
          practiceWebsite: "www.resiliencec.com",
          description: "Professional Mental Health Services",
          subtitle: "Psychotherapy Practice"
        };
      }
      
      const response = await fetch(`/api/system-options/categories/${practiceCategory.id}`);
      const data = await response.json();
      const options = data.options || [];
      return {
        practiceName: options.find((o: any) => o.optionKey === 'practice_name')?.optionLabel || "Resilience Counseling Research & Consultation",
        practiceAddress: options.find((o: any) => o.optionKey === 'practice_address')?.optionLabel || "111 Waterloo St Unit 406, London, ON N6B 2M4",
        practicePhone: options.find((o: any) => o.optionKey === 'practice_phone')?.optionLabel || "+1 (548)866-0366",
        practiceEmail: options.find((o: any) => o.optionKey === 'practice_email')?.optionLabel || "mail@resiliencec.com",
        practiceWebsite: options.find((o: any) => o.optionKey === 'practice_website')?.optionLabel || "www.resiliencec.com",
        description: options.find((o: any) => o.optionKey === 'practice_description')?.optionLabel || "Professional Mental Health Services",
        subtitle: options.find((o: any) => o.optionKey === 'practice_subtitle')?.optionLabel || "Psychotherapy Practice"
      };
    },
  });

  // Update practiceConfig when data is fetched
  useEffect(() => {
    if (practiceSettings) {
      setPracticeConfig(practiceSettings);
    }
  }, [practiceSettings]);

  // Mutation to update practice settings
  const updatePracticeSettingsMutation = useMutation({
    mutationFn: async (settingsData: any) => {
      // Get current practice settings to find option IDs
      const categoriesResponse = await fetch("/api/system-options/categories");
      const categoriesData = await categoriesResponse.json();
      const practiceCategory = categoriesData.find((cat: any) => cat.categoryKey === 'practice_settings');
      
      if (!practiceCategory) {
        throw new Error('Practice settings category not found');
      }
      
      const response = await fetch(`/api/system-options/categories/${practiceCategory.id}`);
      const data = await response.json();
      const options = data.options || [];

      const updates = [
        { optionKey: 'practice_name', optionLabel: settingsData.practiceName },
        { optionKey: 'practice_description', optionLabel: settingsData.description },
        { optionKey: 'practice_subtitle', optionLabel: settingsData.subtitle },
        { optionKey: 'practice_address', optionLabel: settingsData.practiceAddress },
        { optionKey: 'practice_phone', optionLabel: settingsData.practicePhone },
        { optionKey: 'practice_email', optionLabel: settingsData.practiceEmail },
        { optionKey: 'practice_website', optionLabel: settingsData.practiceWebsite }
      ];

      for (const update of updates) {
        const option = options.find((o: any) => o.optionKey === update.optionKey);
        if (option) {
          const updateResponse = await fetch(`/api/system-options/${option.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ optionLabel: update.optionLabel })
          });
          if (!updateResponse.ok) {
            throw new Error(`Failed to update ${update.optionKey}`);
          }
        }
      }
      
      return settingsData;
    },
    onSuccess: (savedData) => {
      // Update local state immediately
      setPracticeConfig(savedData);
      // Then invalidate queries to fetch fresh data
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories/practice_settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-options/categories"] });
      toast({
        title: "Configuration Saved",
        description: "Practice configuration has been updated successfully and will appear in invoices.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save practice configuration. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Fetch categories
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["/api/system-options/categories"],
    queryFn: () => fetch("/api/system-options/categories").then(res => res.json()).then(data => {
      return data.map((category: any) => ({
        id: category.id,
        categoryName: category.categoryName,
        categoryKey: category.categoryKey,
        description: category.description,
        isActive: category.isActive,
        isSystem: category.isSystem,
        optionCount: category.optionCount || 0
      }));
    }),
  });

  // Fetch service codes from Services table - use default queryFn with authentication
  const { data: serviceCodesRaw = [], isLoading: serviceCodesLoading, refetch: refetchServiceCodes, error: serviceCodesError } = useQuery({
    queryKey: ["/api/services"],
    staleTime: 0, // Always refetch when needed
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
    retry: false, // Stop infinite retries on auth failure
    enabled: false, // DISABLED - Need fresh login token
  });

  // Process the raw service codes data
  const serviceCodes = Array.isArray(serviceCodesRaw) ? serviceCodesRaw.map((service: any) => ({
    id: service.id,
    optionKey: service.service_code,
    optionLabel: service.service_name,
    price: service.base_rate || '0.00',
    therapistVisible: service.therapist_visible || false
  })) : [];

  // Fetch rooms
  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ["/api/rooms"],
    queryFn: () => fetch("/api/rooms").then(res => res.json()).then(data => {
      return data.map((room: any) => ({
        id: room.id,
        roomNumber: room.roomNumber,
        roomName: room.roomName,
        capacity: room.capacity,
        isActive: room.isActive
      }));
    }),
  }) as { data: any[], isLoading: boolean };

  // Fetch category with options when selected
  const { data: selectedCategory, isLoading: categoryLoading, error: categoryError } = useQuery({
    queryKey: ["/api/system-options/categories", selectedCategoryId],
    enabled: !!selectedCategoryId,
    staleTime: 0, // Always refetch to avoid caching issues
    queryFn: () => selectedCategoryId ? fetch(`/api/system-options/categories/${selectedCategoryId}`).then(res => res.json()).then(data => {
      return {
        id: data.id,
        categoryName: data.categoryname || data.categoryName, // Handle both cases
        categoryKey: data.categorykey || data.categoryKey,
        description: data.description,
        isActive: data.isactive !== undefined ? data.isactive : data.isActive,
        isSystem: data.issystem !== undefined ? data.issystem : data.isSystem,
        options: data.options?.map((option: any) => ({
          id: option.id,
          optionKey: option.optionkey || option.optionKey,
          optionLabel: option.optionlabel || option.optionLabel,
          sortOrder: option.sortorder !== undefined ? option.sortorder : option.sortOrder,
          isDefault: option.isdefault !== undefined ? option.isdefault : option.isDefault,
          isActive: option.isactive !== undefined ? option.isactive : option.isActive,
          isSystem: option.issystem !== undefined ? option.issystem : option.isSystem
        })) || []
      };
    }) : null,
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
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="system-options">System Options</TabsTrigger>
          <TabsTrigger value="service-prices">Service Prices</TabsTrigger>
          <TabsTrigger value="service-visibility">Service Visibility</TabsTrigger>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="administration">Administration</TabsTrigger>
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

        <TabsContent value="service-visibility" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Service Code Visibility</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Control which service codes therapists can see and use when booking sessions
              </p>
            </div>
          </div>

          <ServiceVisibilityManager />
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

        <TabsContent value="administration" className="space-y-6">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium">Practice Configuration</h3>
              <p className="text-sm text-muted-foreground">
                Manage practice information, contact details, and administrative settings.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Basic Practice Information */}
              <div className="space-y-4">
                <h4 className="text-md font-medium">Practice Information</h4>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="practice-name">Practice Name</Label>
                    <Input
                      id="practice-name"
                      value={practiceConfig.practiceName}
                      onChange={(e) => setPracticeConfig(prev => ({ ...prev, practiceName: e.target.value }))}
                      placeholder="Practice Name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="practice-description">Description</Label>
                    <Input
                      id="practice-description"
                      value={practiceConfig.description}
                      onChange={(e) => setPracticeConfig(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Practice Description"
                    />
                  </div>
                  <div>
                    <Label htmlFor="practice-subtitle">Subtitle</Label>
                    <Input
                      id="practice-subtitle"
                      value={practiceConfig.subtitle}
                      onChange={(e) => setPracticeConfig(prev => ({ ...prev, subtitle: e.target.value }))}
                      placeholder="Practice Subtitle"
                    />
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div className="space-y-4">
                <h4 className="text-md font-medium">Contact Information</h4>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="practice-address">Address</Label>
                    <textarea
                      id="practice-address"
                      className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={practiceConfig.practiceAddress}
                      onChange={(e) => setPracticeConfig(prev => ({ ...prev, practiceAddress: e.target.value }))}
                      placeholder="Practice Address"
                    />
                  </div>
                  <div>
                    <Label htmlFor="practice-phone">Phone</Label>
                    <Input
                      id="practice-phone"
                      value={practiceConfig.practicePhone}
                      onChange={(e) => setPracticeConfig(prev => ({ ...prev, practicePhone: e.target.value }))}
                      placeholder="Phone Number"
                    />
                  </div>
                  <div>
                    <Label htmlFor="practice-email">Email</Label>
                    <Input
                      id="practice-email"
                      type="email"
                      value={practiceConfig.practiceEmail}
                      onChange={(e) => setPracticeConfig(prev => ({ ...prev, practiceEmail: e.target.value }))}
                      placeholder="Contact Email"
                    />
                  </div>
                  <div>
                    <Label htmlFor="practice-website">Website</Label>
                    <Input
                      id="practice-website"
                      value={practiceConfig.practiceWebsite}
                      onChange={(e) => setPracticeConfig(prev => ({ ...prev, practiceWebsite: e.target.value }))}
                      placeholder="Website URL"
                    />
                  </div>
                </div>
              </div>

              {/* Save Actions */}
              <div className="space-y-4">
                <h4 className="text-md font-medium">Actions</h4>
                <div className="space-y-3">
                  <Button 
                    onClick={() => updatePracticeSettingsMutation.mutate(practiceConfig)}
                    disabled={updatePracticeSettingsMutation.isPending}
                    className="w-full"
                  >
                    <Save size={16} className="mr-2" />
                    {updatePracticeSettingsMutation.isPending ? "Saving..." : "Save Configuration"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Configuration is automatically used in invoices, reports, and other documents.
                  </p>
                </div>
              </div>
            </div>
          </div>
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

// Service Visibility Manager Component
function ServiceVisibilityManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Fetch all services (admin view - gets all services regardless of visibility)  
  const { data: servicesRaw = [], isLoading, refetch, error } = useQuery({
    queryKey: ["/api/services"],
    retry: false, // Stop infinite retries on auth failure
    enabled: false, // DISABLED - Need fresh login token
  });

  // Ensure services is always an array
  const services = Array.isArray(servicesRaw) ? servicesRaw : [];

  // Mutation to update service visibility
  const updateVisibilityMutation = useMutation({
    mutationFn: async ({ id, therapistVisible }: { id: number; therapistVisible: boolean }) => {
      return apiRequest(`/api/services/${id}/visibility`, "PUT", { therapistVisible });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/services/filtered"] });
      toast({
        title: "Success",
        description: "Service visibility updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update service visibility",
        variant: "destructive",
      });
    },
  });

  // Bulk operations
  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ serviceIds, therapistVisible }: { serviceIds: number[]; therapistVisible: boolean }) => {
      const promises = serviceIds.map(id => 
        apiRequest(`/api/services/${id}/visibility`, "PUT", { therapistVisible })
      );
      await Promise.all(promises);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/services/filtered"] });
      toast({
        title: "Success", 
        description: `Updated ${variables.serviceIds.length} services successfully`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to bulk update services",
        variant: "destructive",
      });
    },
  });

  const handleToggleVisibility = (service: any) => {
    updateVisibilityMutation.mutate({
      id: service.id,
      therapistVisible: !service.therapistVisible,
    });
  };

  const handleShowAll = () => {
    const hiddenServices = services.filter((s: any) => !s.therapistVisible);
    if (hiddenServices.length > 0) {
      bulkUpdateMutation.mutate({
        serviceIds: hiddenServices.map((s: any) => s.id),
        therapistVisible: true,
      });
    }
  };

  const handleHideAll = () => {
    const visibleServices = services.filter((s: any) => s.therapistVisible);
    if (visibleServices.length > 0) {
      bulkUpdateMutation.mutate({
        serviceIds: visibleServices.map((s: any) => s.id),
        therapistVisible: false,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Loading services...</p>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          Service Code Visibility Control
        </CardTitle>
        <CardDescription>
          Control which service codes therapists can see when booking sessions. Administrators always see all codes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Bulk Actions */}
        <div className="flex gap-2 mb-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleShowAll}
            disabled={bulkUpdateMutation.isPending || services.every((s: any) => s.therapistVisible)}
          >
            Show All to Therapists
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleHideAll}
            disabled={bulkUpdateMutation.isPending || services.every((s: any) => !s.therapistVisible)}
          >
            Hide All from Therapists
          </Button>
        </div>

        {/* Services Table */}
        <div className="border rounded-lg">
          <div className="grid grid-cols-6 gap-4 p-3 bg-gray-50 dark:bg-gray-800 font-medium text-sm border-b">
            <div>Service Code</div>
            <div className="col-span-2">Service Name</div>
            <div>Duration</div>
            <div>Rate</div>
            <div className="text-center">Visible to Therapists</div>
          </div>

          {services.map((service: any) => (
            <div key={service.id} className="grid grid-cols-6 gap-4 p-3 border-b hover:bg-gray-50 dark:hover:bg-gray-800">
              <div className="font-mono text-sm">{service.serviceCode}</div>
              <div className="col-span-2">{service.serviceName}</div>
              <div className="text-sm text-gray-600">{service.duration} min</div>
              <div className="text-sm">${service.baseRate}</div>
              <div className="flex justify-center">
                <Switch
                  checked={service.therapistVisible}
                  onCheckedChange={() => handleToggleVisibility(service)}
                  disabled={updateVisibilityMutation.isPending}
                  data-testid={`switch-service-${service.id}`}
                />
              </div>
            </div>
          ))}

          {services.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              No service codes found. Add service codes in the Service Prices tab.
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="text-sm">
            <div className="font-medium mb-1">Visibility Rules:</div>
            <ul className="text-gray-600 dark:text-gray-300 space-y-1">
              <li>• <strong>Visible:</strong> Therapists can see and use this service code when booking sessions</li>
              <li>• <strong>Hidden:</strong> Therapists cannot see or select this service code (admins can always see all codes)</li>
              <li>• <strong>Historical sessions:</strong> Always show the actual service code used, regardless of current visibility settings</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
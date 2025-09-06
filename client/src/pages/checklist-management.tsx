import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Edit, Trash2, FileText, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChecklistTemplate {
  id: number;
  name: string;
  description?: string;
  category: string;
  clientType?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  items?: ChecklistItem[];
}

interface ChecklistItem {
  id: number;
  templateId: number;
  title: string;
  description?: string;
  isRequired: boolean;
  itemOrder?: number;
  sortOrder: number;
  isActive: boolean;
}

const ChecklistManagement = () => {
  const [activeTab, setActiveTab] = useState("templates");
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({
    name: "",
    description: "",
    category: "",
    clientType: "",
    sortOrder: 1
  });
  const [itemForm, setItemForm] = useState({
    templateId: 0,
    title: "",
    description: "",
    isRequired: true,
    itemOrder: 1,
    sortOrder: 1
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch templates
  const { data: templatesData, isLoading: templatesLoading, refetch: refetchTemplates } = useQuery({
    queryKey: ['/api/checklist-templates'],
    queryFn: async () => {
      const response = await apiRequest('/api/checklist-templates', 'GET');
      return response.json();
    },
    staleTime: 30000, // 30 seconds
  });

  // Ensure templates is always an array
  const templates = Array.isArray(templatesData) ? templatesData : [];

  // Create template mutation
  const createTemplateMutation = useMutation({
    mutationFn: async (template: any) => {
      const response = await apiRequest('/api/checklist-templates', 'POST', template);
      return response.json();
    },
    onSuccess: () => {
      // Force refetch templates
      queryClient.invalidateQueries({ queryKey: ['/api/checklist-templates'] });
      refetchTemplates();
      setIsTemplateDialogOpen(false);
      setTemplateForm({ name: "", description: "", category: "", clientType: "", sortOrder: 1 });
      toast({ title: "Success", description: "Checklist template created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create template", variant: "destructive" });
    }
  });

  // Create item mutation
  const createItemMutation = useMutation({
    mutationFn: async (item: any) => {
      const response = await apiRequest('/api/checklist-items', 'POST', item);
      return response.json();
    },
    onSuccess: () => {
      // Force refetch templates after item creation and invalidate client checklists
      queryClient.invalidateQueries({ queryKey: ['/api/checklist-templates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      refetchTemplates();
      setIsItemDialogOpen(false);
      setItemForm({ templateId: 0, title: "", description: "", isRequired: true, itemOrder: 1, sortOrder: 1 });
      toast({ title: "Success", description: "Checklist item created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create item", variant: "destructive" });
    }
  });

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: number) => {
      const response = await apiRequest(`/api/checklist-templates/${templateId}`, 'DELETE');
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/checklist-templates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      refetchTemplates();
      toast({ title: "Success", description: "Template deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete template", variant: "destructive" });
    }
  });

  // Delete item mutation
  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const response = await apiRequest(`/api/checklist-items/${itemId}`, 'DELETE');
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/checklist-templates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      refetchTemplates();
      toast({ title: "Success", description: "Checklist item deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete item", variant: "destructive" });
    }
  });

  const handleCreateTemplate = () => {
    createTemplateMutation.mutate(templateForm);
  };

  const handleCreateItem = () => {
    createItemMutation.mutate(itemForm);
  };

  const handleDeleteTemplate = (templateId: number) => {
    if (confirm("Are you sure you want to delete this template? This action cannot be undone.")) {
      deleteTemplateMutation.mutate(templateId);
    }
  };

  const handleDeleteItem = (itemId: number) => {
    if (confirm("Are you sure you want to delete this checklist item? This action cannot be undone.")) {
      deleteItemMutation.mutate(itemId);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'intake': return 'bg-blue-100 text-blue-800';
      case 'assessment': return 'bg-purple-100 text-purple-800';
      case 'ongoing': return 'bg-green-100 text-green-800';
      case 'discharge': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'intake': return <FileText className="w-4 h-4" />;
      case 'assessment': return <CheckCircle className="w-4 h-4" />;
      case 'ongoing': return <Clock className="w-4 h-4" />;
      case 'discharge': return <AlertCircle className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Healthcare Process Checklists</h1>
        <p className="text-slate-600 mt-2">Create and manage standardized healthcare process checklists for regulatory compliance</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="templates">Checklist Templates</TabsTrigger>
          <TabsTrigger value="items">Checklist Items</TabsTrigger>
        </TabsList>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Checklist Templates</h2>
            <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Template
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Create Checklist Template</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="template-name">Template Name</Label>
                    <Input
                      id="template-name"
                      value={templateForm.name}
                      onChange={(e) => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Client Intake Process"
                    />
                  </div>
                  <div>
                    <Label htmlFor="template-description">Description</Label>
                    <Textarea
                      id="template-description"
                      value={templateForm.description}
                      onChange={(e) => setTemplateForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe the checklist purpose and usage"
                    />
                  </div>
                  <div>
                    <Label htmlFor="template-category">Category</Label>
                    <Select value={templateForm.category} onValueChange={(value) => setTemplateForm(prev => ({ ...prev, category: value }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="intake">Intake</SelectItem>
                        <SelectItem value="assessment">Assessment</SelectItem>
                        <SelectItem value="ongoing">Ongoing Care</SelectItem>
                        <SelectItem value="discharge">Discharge</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="template-sort">Sort Order</Label>
                    <Input
                      id="template-sort"
                      type="number"
                      value={templateForm.sortOrder}
                      onChange={(e) => setTemplateForm(prev => ({ ...prev, sortOrder: parseInt(e.target.value) || 1 }))}
                    />
                  </div>
                  <Button onClick={handleCreateTemplate} className="w-full">
                    Create Template
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {templatesLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-6">
                      <div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              templates.map((template) => (
                <Card key={template.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getCategoryIcon(template.category)}
                        <div>
                          <CardTitle className="text-lg">{template.name}</CardTitle>
                          {template.description && (
                            <p className="text-sm text-slate-600 mt-1">{template.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={getCategoryColor(template.category)}>
                          {template.category}
                        </Badge>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm">
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleDeleteTemplate(template.id)}
                            disabled={deleteTemplateMutation.isPending}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  {template.items && template.items.length > 0 && (
                    <CardContent>
                      <div className="text-sm text-slate-600 mb-3">
                        {template.items.length} items • {template.items.filter(item => item.isRequired).length} required
                      </div>
                      <div className="space-y-2">
                        {template.items.slice(0, 3).map((item: any) => (
                          <div key={item.id} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-slate-400" />
                              <span className="text-sm font-medium">{item.title}</span>
                              {item.isRequired && (
                                <Badge variant="outline" className="text-xs">Required</Badge>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">
                              Order {item.itemOrder}
                            </div>
                          </div>
                        ))}
                        {template.items.length > 3 && (
                          <div className="text-xs text-slate-500 text-center pt-2">
                            +{template.items.length - 3} more items
                          </div>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Items Tab */}
        <TabsContent value="items" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Checklist Items</h2>
            <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Item
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Add Checklist Item</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="item-template">Template</Label>
                    <Select value={itemForm.templateId.toString()} onValueChange={(value) => setItemForm(prev => ({ ...prev, templateId: parseInt(value) }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((template) => (
                          <SelectItem key={template.id} value={template.id.toString()}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="item-title">Item Title</Label>
                    <Input
                      id="item-title"
                      value={itemForm.title}
                      onChange={(e) => setItemForm(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="e.g., Complete intake assessment"
                    />
                  </div>
                  <div>
                    <Label htmlFor="item-description">Description</Label>
                    <Textarea
                      id="item-description"
                      value={itemForm.description}
                      onChange={(e) => setItemForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Detailed description of the required action"
                    />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Label htmlFor="item-order">Item Order</Label>
                      <Input
                        id="item-order"
                        type="number"
                        value={itemForm.itemOrder}
                        onChange={(e) => setItemForm(prev => ({ ...prev, itemOrder: parseInt(e.target.value) || 1 }))}
                      />
                    </div>
                    <div className="flex items-center space-x-2 pt-6">
                      <input
                        type="checkbox"
                        id="item-required"
                        checked={itemForm.isRequired}
                        onChange={(e) => setItemForm(prev => ({ ...prev, isRequired: e.target.checked }))}
                      />
                      <Label htmlFor="item-required">Required</Label>
                    </div>
                  </div>
                  <Button onClick={handleCreateItem} className="w-full">
                    Add Item
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-6">
            {templates.map((template) => (
              template.items && template.items.length > 0 && (
                <Card key={template.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getCategoryIcon(template.category)}
                        <div>
                          <CardTitle className="text-lg">{template.name}</CardTitle>
                          <p className="text-sm text-slate-600">{template.items.length} items</p>
                        </div>
                      </div>
                      <Badge className={getCategoryColor(template.category)}>
                        {template.category}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {template.items
                        .sort((a: any, b: any) => (a.itemOrder || 0) - (b.itemOrder || 0))
                        .map((item: any, index: number) => (
                        <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-6 h-6 bg-slate-100 rounded-full text-xs font-medium">
                              {index + 1}
                            </div>
                            <div>
                              <div className="font-medium">{item.title}</div>
                              {item.description && (
                                <div className="text-sm text-slate-600">{item.description}</div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-xs text-slate-500">Order {item.itemOrder}</div>
                            {item.isRequired && (
                              <Badge variant="outline" className="text-xs">Required</Badge>
                            )}
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-red-600 hover:text-red-700"
                              onClick={() => handleDeleteItem(item.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )
            ))}
            
            {templates.every((t: any) => !t.items || t.items.length === 0) && (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">No Checklist Items</h3>
                <p className="text-slate-600">Create templates first, then add items to build your checklists</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ChecklistManagement;
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Archive, FileText, Edit2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

type FormTemplate = {
  id: number;
  name: string;
  description: string | null;
  category: string;
  requiresSignature: boolean;
  isActive: boolean;
  isSystemTemplate: boolean;
  sortOrder: number;
  createdAt: Date;
};

const CATEGORY_OPTIONS = [
  { value: "consent", label: "Informed Consent" },
  { value: "intake", label: "Client Intake" },
  { value: "release", label: "Release of Information" },
  { value: "agreement", label: "Treatment Agreement" },
  { value: "safety", label: "Safety Plan" },
  { value: "discharge", label: "Discharge Summary" },
  { value: "custom", label: "Custom Form" },
];

const CATEGORY_COLORS: Record<string, string> = {
  consent: "bg-blue-100 text-blue-800",
  intake: "bg-green-100 text-green-800",
  release: "bg-purple-100 text-purple-800",
  agreement: "bg-orange-100 text-orange-800",
  safety: "bg-red-100 text-red-800",
  discharge: "bg-gray-100 text-gray-800",
  custom: "bg-yellow-100 text-yellow-800",
};

export default function FormsManagementPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "consent",
    requiresSignature: true,
    isActive: true,
  });

  // Fetch all form templates
  const { data: templates, isLoading } = useQuery<FormTemplate[]>({
    queryKey: ["/api/forms/templates"],
  });

  // Create template mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("/api/forms/templates", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forms/templates"] });
      setIsCreateDialogOpen(false);
      setFormData({
        name: "",
        description: "",
        category: "consent",
        requiresSignature: true,
        isActive: true,
      });
      toast({
        title: "Success",
        description: "Form template created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create form template",
        variant: "destructive",
      });
    },
  });

  // Archive template mutation
  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest(`/api/forms/templates/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forms/templates"] });
      toast({
        title: "Success",
        description: "Form template archived successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to archive form template",
        variant: "destructive",
      });
    },
  });

  const handleCreateTemplate = () => {
    createMutation.mutate(formData);
  };

  const handleArchiveTemplate = (id: number, isSystem: boolean) => {
    if (isSystem) {
      toast({
        title: "Cannot Archive",
        description: "System templates cannot be archived",
        variant: "destructive",
      });
      return;
    }
    
    if (confirm("Are you sure you want to archive this form template?")) {
      archiveMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Clinical Forms</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage form templates for client consent, intake, and documentation
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-form">
              <Plus className="w-4 h-4 mr-2" />
              New Form Template
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create Form Template</DialogTitle>
              <DialogDescription>
                Create a new form template that can be assigned to clients
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Form Name</Label>
                <Input
                  id="name"
                  data-testid="input-form-name"
                  placeholder="e.g., HIPAA Privacy Notice"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger data-testid="select-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  data-testid="input-description"
                  placeholder="Brief description of this form..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="requiresSignature">Requires Signature</Label>
                <Switch
                  id="requiresSignature"
                  data-testid="switch-signature"
                  checked={formData.requiresSignature}
                  onCheckedChange={(checked) => 
                    setFormData({ ...formData, requiresSignature: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="isActive">Active</Label>
                <Switch
                  id="isActive"
                  data-testid="switch-active"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => 
                    setFormData({ ...formData, isActive: checked })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateTemplate}
                disabled={!formData.name || createMutation.isPending}
                data-testid="button-save-template"
              >
                {createMutation.isPending ? "Creating..." : "Create Template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Form Templates</CardTitle>
          <CardDescription>
            Create and manage form templates that can be assigned to clients
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-600 dark:text-gray-400 mt-2">Loading templates...</p>
            </div>
          ) : !templates || templates.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">No form templates yet</p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                Create your first form template to get started
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Signature</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id} data-testid={`row-template-${template.id}`}>
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={CATEGORY_COLORS[template.category] || ""}
                      >
                        {CATEGORY_OPTIONS.find((c) => c.value === template.category)?.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {template.requiresSignature ? (
                        <Badge variant="secondary">Required</Badge>
                      ) : (
                        <span className="text-gray-500">Not Required</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {template.isActive ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {template.isSystemTemplate && (
                        <Badge variant="outline">System</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-edit-${template.id}`}
                        onClick={() => navigate(`/forms-builder/${template.id}`)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-archive-${template.id}`}
                        onClick={() => handleArchiveTemplate(template.id, template.isSystemTemplate)}
                        disabled={template.isSystemTemplate}
                      >
                        <Archive className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

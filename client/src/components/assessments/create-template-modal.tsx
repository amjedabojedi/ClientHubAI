import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { InsertAssessmentTemplate } from "@shared/schema";

interface CreateTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTemplateModal({ open, onOpenChange }: CreateTemplateModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "clinical",
    isStandardized: false,
    version: "1.0"
  });
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createTemplateMutation = useMutation({
    mutationFn: async (data: InsertAssessmentTemplate) => {
      return apiRequest(`/api/assessments/templates`, "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments/templates"] });
      toast({
        title: "Template Created",
        description: "New assessment template has been created successfully",
      });
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: "Creation Failed", 
        description: error.message || "Unable to create template. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // For now, we'll use a hardcoded therapist ID (3) since we don't have user authentication
      const templateData: InsertAssessmentTemplate = {
        ...formData,
        createdById: 3,
        isActive: true
      };

      await createTemplateMutation.mutateAsync(templateData);
    } catch (error) {
      // Error handled by mutation onError
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      name: "",
      description: "",
      category: "clinical",
      isStandardized: false,
      version: "1.0"
    });
    onOpenChange(false);
  };

  const isFormValid = formData.name.trim() && formData.description.trim() && formData.category && formData.version.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create Assessment Template</DialogTitle>
          <DialogDescription>
            Create a new assessment template that can be assigned to clients.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name*</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Initial Mental Health Assessment"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="category">Category*</Label>
              <Select 
                value={formData.category} 
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clinical">Clinical</SelectItem>
                  <SelectItem value="psychological">Psychological</SelectItem>
                  <SelectItem value="behavioral">Behavioral</SelectItem>
                  <SelectItem value="cognitive">Cognitive</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description*</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe the purpose and scope of this assessment..."
              rows={3}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="version">Version*</Label>
              <Input
                id="version"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                placeholder="e.g., 1.0, 2.1"
                required
              />
            </div>

            <div className="flex items-center space-x-2 pt-6">
              <Switch
                id="standardized"
                checked={formData.isStandardized}
                onCheckedChange={(checked) => setFormData({ ...formData, isStandardized: checked })}
              />
              <Label htmlFor="standardized">Standardized Assessment</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!isFormValid || isLoading}
            >
              {isLoading ? "Creating..." : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// UI Components
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

// Icons
import { Calendar as CalendarIcon, Search, User, FileText } from "lucide-react";

// Utils
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// Types
import type { AssessmentTemplate } from "@shared/schema";

interface Client {
  id: number;
  clientId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  status: string;
}

interface AssignAssessmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: AssessmentTemplate;
  preSelectedClientId?: number;
}

export function AssignAssessmentModal({ open, onOpenChange, template, preSelectedClientId }: AssignAssessmentModalProps) {
  const [selectedClientId, setSelectedClientId] = useState<string>(preSelectedClientId?.toString() || "");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch clients for selection
  const { data: clients = [], isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    select: (data: any) => data.clients?.filter((client: any) => client.status === "active") || [],
  });

  // Fetch assessment templates if no template is pre-selected
  const { data: templates = [] } = useQuery<AssessmentTemplate[]>({
    queryKey: ["/api/assessments/templates"],
    enabled: !template,
  });

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(template?.id.toString() || "");

  // Filter clients based on search
  const filteredClients = clients.filter(client =>
    client.fullName.toLowerCase().includes(clientSearch.toLowerCase()) ||
    client.clientId.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // Assignment mutation
  const assignmentMutation = useMutation({
    mutationFn: async (assignmentData: any) => {
      return apiRequest(`/api/clients/${assignmentData.clientId}/assessments`, "POST", {
        templateId: parseInt(assignmentData.templateId),
        assignedBy: 6, // Current user ID - in real app, this would come from session
        dueDate: assignmentData.dueDate,
        notes: assignmentData.notes
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assessments/assignments"] });
      toast({
        title: "Assessment Assigned",
        description: "The assessment has been successfully assigned to the client.",
      });
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Assignment Failed",
        description: error.message || "Failed to assign assessment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    if (!preSelectedClientId) setSelectedClientId("");
    if (!template) setSelectedTemplateId("");
    setDueDate(undefined);
    setNotes("");
    setClientSearch("");
  };

  const handleSubmit = () => {
    if (!selectedClientId || (!template && !selectedTemplateId)) {
      toast({
        title: "Missing Information",
        description: "Please select both a client and an assessment template.",
        variant: "destructive",
      });
      return;
    }

    assignmentMutation.mutate({
      clientId: parseInt(selectedClientId),
      templateId: template?.id || parseInt(selectedTemplateId),
      dueDate: dueDate ? dueDate.toISOString().split('T')[0] : null,
      notes
    });
  };

  const selectedClient = clients.find(c => c.id.toString() === selectedClientId);
  const selectedTemplate = template || templates.find(t => t.id.toString() === selectedTemplateId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Assign Assessment
          </DialogTitle>
          <DialogDescription>
            Assign an assessment template to a client for completion.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Template Selection - only show if no template is pre-selected */}
          {!template && (
            <div className="space-y-2">
              <Label htmlFor="template">Assessment Template</Label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an assessment template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((tmpl) => (
                    <SelectItem key={tmpl.id} value={tmpl.id.toString()}>
                      <div className="flex flex-col">
                        <span className="font-medium">{tmpl.name}</span>
                        <span className="text-xs text-muted-foreground capitalize">{tmpl.category}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Template Info - show if template is pre-selected */}
          {template && (
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4" />
                <span className="font-medium">Selected Template</span>
              </div>
              <div>
                <p className="font-medium">{template.name}</p>
                <p className="text-sm text-muted-foreground capitalize">{template.category}</p>
                {template.description && (
                  <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                )}
              </div>
            </div>
          )}

          {/* Client Selection */}
          <div className="space-y-2">
            <Label htmlFor="client">Client</Label>
            {preSelectedClientId ? (
              <div className="bg-muted/50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <User className="h-4 w-4" />
                  <span className="font-medium">Selected Client</span>
                </div>
                {selectedClient && (
                  <div>
                    <p className="font-medium">{selectedClient.fullName}</p>
                    <p className="text-sm text-muted-foreground">ID: {selectedClient.clientId}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search clients..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {clientsLoading ? (
                      <SelectItem value="loading" disabled>
                        Loading clients...
                      </SelectItem>
                    ) : filteredClients.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No clients found
                      </SelectItem>
                    ) : (
                      filteredClients.map((client) => (
                        <SelectItem key={client.id} value={client.id.toString()}>
                          <div className="flex flex-col">
                            <span className="font-medium">{client.fullName}</span>
                            <span className="text-xs text-muted-foreground">ID: {client.clientId}</span>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label>Due Date (Optional)</Label>
            <Popover open={showCalendar} onOpenChange={setShowCalendar}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !dueDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? format(dueDate, "PPP") : "Select due date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate}
                  onSelect={(date) => {
                    setDueDate(date);
                    setShowCalendar(false);
                  }}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any additional notes or instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={assignmentMutation.isPending}
          >
            {assignmentMutation.isPending ? "Assigning..." : "Assign Assessment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
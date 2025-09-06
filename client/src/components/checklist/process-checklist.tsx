import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Clock, AlertCircle, User, FileText } from "lucide-react";
import { useState } from "react";

interface ChecklistItem {
  id: number;
  checklistItemId: number;
  isCompleted: boolean;
  completedAt?: string;
  completedBy?: number;
  notes?: string;
  checklistItem: {
    id: number;
    title: string;
    description?: string;
    isRequired: boolean;
    itemOrder?: number;
  };
  completedByUser?: {
    id: number;
    username: string;
  };
}

interface ProcessChecklist {
  id: number;
  templateId: number;
  isCompleted: boolean;
  completedAt?: string;
  dueDate?: string;
  notes?: string;
  template: {
    id: number;
    name: string;
    description?: string;
    category: string;
  };
  items: ChecklistItem[];
}

interface ProcessChecklistProps {
  clientId: number;
}

const ProcessChecklistComponent = ({ clientId }: ProcessChecklistProps) => {
  const [expandedChecklist, setExpandedChecklist] = useState<number | null>(null);
  const [itemNotes, setItemNotes] = useState<{ [key: number]: string }>({});
  const queryClient = useQueryClient();

  // Fetch client checklists from API
  const { data: checklists = [], isLoading } = useQuery<ProcessChecklist[]>({
    queryKey: ['/api/clients', clientId, 'checklists'],
    enabled: !!clientId,
  });

  // Update checklist item mutation
  const updateItemMutation = useMutation({
    mutationFn: (params: { itemId: number; data: any }) =>
      apiRequest(`/api/client-checklist-items/${params.itemId}`, 'PUT', params.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients', clientId, 'checklists'] });
      queryClient.invalidateQueries({ queryKey: ['/api/checklist-templates'] });
    }
  });

  const handleItemComplete = (itemId: number, isCompleted: boolean) => {
    updateItemMutation.mutate({
      itemId,
      data: {
        isCompleted,
        completedBy: 1, // Current user ID - in real app this would come from auth
        notes: itemNotes[itemId] || ''
      }
    });
  };

  const handleNotesChange = (itemId: number, notes: string) => {
    setItemNotes(prev => ({ ...prev, [itemId]: notes }));
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

  const calculateProgress = (items: ChecklistItem[]) => {
    if (items.length === 0) return 0;
    const completed = items.filter(item => item.isCompleted).length;
    return Math.round((completed / items.length) * 100);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-slate-200 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!checklists || checklists.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center py-8">
            <CheckCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Process Checklists</h3>
            <p className="text-slate-600">Process checklists will be automatically assigned when this client is created.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {checklists.map((checklist: ProcessChecklist) => {
        const progress = calculateProgress(checklist.items);
        const isExpanded = expandedChecklist === checklist.id;

        return (
          <Card key={checklist.id} className="overflow-hidden">
            <CardHeader 
              className="cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => setExpandedChecklist(isExpanded ? null : checklist.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getCategoryIcon(checklist.template.category)}
                  <div>
                    <CardTitle className="text-lg">{checklist.template.name}</CardTitle>
                    {checklist.template.description && (
                      <p className="text-sm text-slate-600 mt-1">{checklist.template.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className={getCategoryColor(checklist.template.category)}>
                    {checklist.template.category}
                  </Badge>
                  <div className="text-right">
                    <div className="text-sm font-medium">{progress}% Complete</div>
                    <Progress value={progress} className="w-24 h-2" />
                  </div>
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {checklist.items.map((item: ChecklistItem) => (
                    <div key={item.id} className="border rounded-lg p-4 bg-slate-50">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={item.isCompleted}
                          onCheckedChange={(checked) => 
                            handleItemComplete(item.id, checked as boolean)
                          }
                          disabled={updateItemMutation.isPending}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className={`font-medium ${item.isCompleted ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                              {item.checklistItem.title}
                            </h4>
                            {item.checklistItem.isRequired && (
                              <Badge variant="outline" className="text-xs">Required</Badge>
                            )}
                          </div>
                          
                          {item.checklistItem.description && (
                            <p className="text-sm text-slate-600 mb-2">{item.checklistItem.description}</p>
                          )}

                          {item.isCompleted && item.completedAt && (
                            <div className="flex items-center gap-4 text-xs text-slate-500 mb-2">
                              <span className="flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />
                                Completed: {new Date(item.completedAt).toLocaleDateString()}
                              </span>
                              {item.completedByUser && (
                                <span className="flex items-center gap-1">
                                  <User className="w-3 h-3" />
                                  By: {item.completedByUser.username}
                                </span>
                              )}
                            </div>
                          )}

                          <Textarea
                            placeholder="Add notes (optional)"
                            value={itemNotes[item.id] || item.notes || ''}
                            onChange={(e) => handleNotesChange(item.id, e.target.value)}
                            className="text-sm mt-2"
                            rows={2}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {checklist.dueDate && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-2 text-blue-800">
                      <Clock className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        Due Date: {new Date(checklist.dueDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
};

export default ProcessChecklistComponent;
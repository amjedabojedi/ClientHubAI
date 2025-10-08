import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Eye, Edit, CalendarDays, Plus, Paperclip, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Pagination from "./pagination";
import { Client, ClientsQueryResult } from "@/types/client";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuth } from "@/hooks/useAuth";
import QuickTaskForm from "@/components/task-management/quick-task-form";
import { format } from "date-fns";

interface ClientDataGridProps {
  activeTab: string;
  searchQuery: string;
  filters: {
    stage: string;
    therapistId: string;
    clientType: string;
    hasPortalAccess?: boolean;
    hasPendingTasks?: boolean;
    hasNoSessions?: boolean;
    checklistTemplateId?: string;
    checklistItemId?: string;
  };
  onViewClient: (client: Client) => void;
  onEditClient: (client: Client) => void;
  onDeleteClient?: (client: Client) => void;
}

export default function ClientDataGrid({ 
  activeTab, 
  searchQuery, 
  filters, 
  onViewClient,
  onEditClient,
  onDeleteClient
}: ClientDataGridProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Force cache invalidation when user changes to ensure fresh data
  React.useEffect(() => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    }
  }, [user?.id, user?.role, queryClient]);
  
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedClients, setSelectedClients] = useState<number[]>([]);
  
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Map activeTab to stage filter
  const stageFromTab = useMemo(() => {
    switch (activeTab) {
      case "intake":
      case "intakes": return "intake";
      case "assessment": return "assessment";
      case "psychotherapy": return "psychotherapy";
      case "closed": return "closed";
      case "no-sessions": return { hasNoSessions: true };
      case "follow-up": return { needsFollowUp: true };
      case "unassigned": return { unassigned: true };
      default: return "";
    }
  }, [activeTab]);

  const queryParams = useMemo(() => {
    const params = {
      page,
      pageSize,
      search: debouncedSearch,
      stage: typeof stageFromTab === "string" ? stageFromTab : filters.stage,
      therapistId: filters.therapistId,
      clientType: filters.clientType,
      hasPortalAccess: filters.hasPortalAccess,
      hasPendingTasks: filters.hasPendingTasks,
      hasNoSessions: typeof stageFromTab === "object" && stageFromTab.hasNoSessions ? true : filters.hasNoSessions,
      needsFollowUp: typeof stageFromTab === "object" && stageFromTab.needsFollowUp ? true : undefined,
      unassigned: typeof stageFromTab === "object" && stageFromTab.unassigned ? true : undefined,
      checklistTemplateId: filters.checklistTemplateId,
      checklistItemId: filters.checklistItemId,
      sortBy,
      sortOrder,
      currentUserId: user?.id,
      currentUserRole: user?.role,
    };
    return params;
  }, [page, pageSize, debouncedSearch, stageFromTab, filters, sortBy, sortOrder, user]);

  const { data, isLoading, error } = useQuery<ClientsQueryResult>({
    queryKey: ["/api/clients", queryParams],
    enabled: !!user && !!user?.id, // Only fetch when user is fully loaded
    staleTime: 30000, // Cache for 30 seconds for better tab switching performance
  });

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedClients(data?.clients?.map((c: Client) => c.id) || []);
    } else {
      setSelectedClients([]);
    }
  };

  const handleSelectClient = (clientId: number, checked: boolean) => {
    if (checked) {
      setSelectedClients([...selectedClients, clientId]);
    } else {
      setSelectedClients(selectedClients.filter(id => id !== clientId));
    }
  };

  const getStageBadge = (stage: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      intake: "outline",
      assessment: "secondary", 
      psychotherapy: "default",
      closed: "destructive",
    };
    const colors: Record<string, string> = {
      intake: "bg-blue-100 text-blue-800",
      assessment: "bg-purple-100 text-purple-800",
      psychotherapy: "bg-green-100 text-green-800",
      closed: "bg-gray-100 text-gray-800",
    };
    return (
      <Badge variant={variants[stage] || "default"} className={colors[stage] || ""}>
        {stage.charAt(0).toUpperCase() + stage.slice(1)}
      </Badge>
    );
  };

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <div className="text-center text-red-600">
          <i className="fas fa-exclamation-circle text-2xl mb-2"></i>
          <p>Error loading clients. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <h3 className="text-lg font-semibold text-slate-900">Client Directory</h3>
            <div className="flex items-center space-x-2 text-sm text-slate-600">
              <span>
                Showing {((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, data?.total || 0)} of {data?.total?.toLocaleString() || 0} clients
              </span>
              <span className="text-slate-400">•</span>
              <span>Response time: {isLoading ? 'Loading...' : '120ms'}</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="sm">
              <i className="fas fa-sync-alt"></i>
            </Button>
            <Button variant="ghost" size="sm">
              <i className="fas fa-th-large"></i>
            </Button>
            <Button variant="ghost" size="sm" className="bg-slate-100">
              <i className="fas fa-list"></i>
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox 
                    checked={selectedClients.length === data?.clients?.length && data?.clients?.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-slate-50" onClick={() => handleSort("name")}>
                  <div className="flex items-center space-x-1">
                    <span>Client Name</span>
                    <i className={`fas fa-sort${sortBy === "name" ? (sortOrder === "asc" ? "-up" : "-down") : ""} text-slate-400`}></i>
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-slate-50" onClick={() => handleSort("therapist")}>
                  <div className="flex items-center space-x-1">
                    <span>Therapist</span>
                    <i className={`fas fa-sort${sortBy === "therapist" ? (sortOrder === "asc" ? "-up" : "-down") : ""} text-slate-400`}></i>
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-slate-50" onClick={() => handleSort("lastSession")}>
                  <div className="flex items-center space-x-1">
                    <span>Last Session</span>
                    <i className={`fas fa-sort${sortBy === "lastSession" ? (sortOrder === "asc" ? "-up" : "-down") : ""} text-slate-400`}></i>
                  </div>
                </TableHead>
                <TableHead>Since Last Session</TableHead>
                <TableHead>Checklist</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: pageSize }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7} className="text-center py-8">
                      <div className="flex items-center justify-center space-x-2">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span>Loading clients...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : data?.clients?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <div className="text-slate-500">
                      <i className="fas fa-users text-2xl mb-2"></i>
                      <p>No clients found matching your criteria.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                data?.clients?.map((client: any) => (
                  <TableRow key={client.id} className="hover:bg-slate-50">
                    <TableCell>
                      <Checkbox 
                        checked={selectedClients.includes(client.id)}
                        onCheckedChange={(checked) => handleSelectClient(client.id, checked as boolean)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <p 
                            className="font-medium text-slate-900 cursor-pointer hover:text-primary"
                            onClick={() => onViewClient(client)}
                          >
                            {client.fullName}
                          </p>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div 
                                  className="relative inline-flex items-center"
                                  data-testid={`icon-docs-${client.id}`}
                                >
                                  <Paperclip 
                                    className={`w-4 h-4 ${
                                      (client.documentCount || 0) > 0 
                                        ? 'text-slate-600' 
                                        : 'text-slate-300'
                                    }`} 
                                  />
                                  {(client.documentCount || 0) > 0 && (
                                    <Badge 
                                      variant="secondary" 
                                      className="ml-1 text-xs px-1.5 py-0.5 min-w-[1.25rem] h-5 bg-blue-100 text-blue-800 border-blue-200"
                                      data-testid={`badge-docs-${client.id}`}
                                    >
                                      {client.documentCount}
                                    </Badge>
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{(client.documentCount || 0)} document{(client.documentCount || 0) !== 1 ? 's' : ''}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <p className="text-sm text-slate-500">Ref: {client.referenceNumber}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-900">
                        {client.assignedTherapist?.fullName || 'Unassigned'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <p className="text-slate-900">
                          {client.lastSessionDate 
                            ? format(new Date(client.lastSessionDate), 'MMM dd, yyyy')
                            : 'No sessions'
                          }
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="w-28">
                        {(() => {
                          const calculateSessionGap = (lastSessionDate: string | null) => {
                            if (!lastSessionDate) return { gap: "No sessions", color: "text-slate-400" };
                            
                            const lastSession = new Date(lastSessionDate);
                            const today = new Date();
                            const daysSinceLastSession = Math.floor((today.getTime() - lastSession.getTime()) / (1000 * 60 * 60 * 24));
                            
                            let gap, color;
                            if (daysSinceLastSession === 0) {
                              gap = "Today";
                              color = "text-green-600 font-medium";
                            } else if (daysSinceLastSession === 1) {
                              gap = "1 day";
                              color = "text-green-600";
                            } else if (daysSinceLastSession < 30) {
                              gap = `${daysSinceLastSession} days`;
                              color = "text-green-600";
                            } else if (daysSinceLastSession < 90) {
                              const months = Math.floor(daysSinceLastSession / 30);
                              const remainingDays = daysSinceLastSession % 30;
                              gap = months === 1 ? 
                                (remainingDays > 0 ? `1m ${remainingDays}d` : "1 month") :
                                (remainingDays > 0 ? `${months}m ${remainingDays}d` : `${months} months`);
                              color = "text-yellow-600";
                            } else {
                              const months = Math.floor(daysSinceLastSession / 30);
                              const remainingDays = daysSinceLastSession % 30;
                              gap = months === 1 ? 
                                (remainingDays > 0 ? `1m ${remainingDays}d` : "1 month") :
                                (remainingDays > 0 ? `${months}m ${remainingDays}d` : `${months} months`);
                              color = "text-red-600";
                            }
                            
                            return { gap, color };
                          };
                          
                          const result = calculateSessionGap(client.lastSessionDate);
                          
                          return (
                            <div className="text-center space-y-1">
                              <div className={`text-sm font-medium ${result.color}`}>
                                {result.gap}
                              </div>
                              {client.needsFollowUp && (
                                <div className="space-y-1">
                                  <Badge 
                                    variant={
                                      client.followUpPriority === 'urgent' ? 'destructive' :
                                      client.followUpPriority === 'high' ? 'default' :
                                      client.followUpPriority === 'medium' ? 'secondary' :
                                      'outline'
                                    }
                                    className={`text-xs px-1 py-0 ${
                                      client.followUpPriority === 'urgent' ? 'bg-red-500 text-white' :
                                      client.followUpPriority === 'high' ? 'bg-orange-500 text-white' :
                                      client.followUpPriority === 'medium' ? 'bg-yellow-500 text-white' :
                                      'bg-blue-500 text-white'
                                    }`}
                                  >
                                    {client.followUpPriority?.toUpperCase() || 'FU'}
                                  </Badge>
                                  {client.followUpDate && (
                                    <p className="text-xs text-orange-600">
                                      Due: {format(new Date(client.followUpDate), 'MMM dd, yyyy')}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {client.checklistProgress && client.checklistProgress.total > 0 ? (
                          <div className="flex items-center space-x-2">
                            <span className="text-slate-900 font-medium">
                              {client.checklistProgress.completed}/{client.checklistProgress.total}
                            </span>
                            <span className="text-slate-500">
                              ({Math.round((client.checklistProgress.completed / client.checklistProgress.total) * 100)}%)
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => onViewClient(client)}
                          className="p-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50"
                          title="View Client"
                          data-testid={`button-view-${client.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                              title="More Actions"
                              data-testid={`button-more-${client.id}`}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem 
                              onClick={() => window.location.href = `/scheduling?clientId=${client.id}&clientName=${encodeURIComponent(client.fullName)}&therapistId=${client.assignedTherapistId || ''}&therapistName=${encodeURIComponent(client.assignedTherapist?.fullName || '')}`}
                              data-testid={`action-schedule-${client.id}`}
                            >
                              <CalendarDays className="w-4 h-4 mr-2" />
                              Schedule Session
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => onEditClient(client)}
                              data-testid={`action-edit-${client.id}`}
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              Edit Client
                            </DropdownMenuItem>
                            <QuickTaskForm
                              clientId={client.id}
                              clientName={client.fullName}
                              defaultAssigneeId={client.assignedTherapistId}
                              trigger={
                                <DropdownMenuItem data-testid={`action-task-${client.id}`}>
                                  <Plus className="w-4 h-4 mr-2" />
                                  Create Task
                                </DropdownMenuItem>
                              }
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <Pagination 
          currentPage={page}
          totalPages={data?.totalPages || 1}
          pageSize={pageSize}
          total={data?.total || 0}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}

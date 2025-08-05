import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Eye, Edit, Trash2, CalendarDays } from "lucide-react";
import Pagination from "./pagination";
import { Client } from "@/types/client";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuth } from "@/hooks/useAuth";

interface ClientDataGridProps {
  activeTab: string;
  searchQuery: string;
  filters: {
    status: string;
    therapistId: string;
    clientType: string;
    hasPortalAccess?: boolean;
    hasPendingTasks?: boolean;
  };
  onViewClient: (client: Client) => void;
  onEditClient: (client: Client) => void;
  onDeleteClient: (client: Client) => void;
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedClients, setSelectedClients] = useState<number[]>([]);
  
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Map activeTab to status filter
  const statusFromTab = useMemo(() => {
    switch (activeTab) {
      case "active": return "active";
      case "inactive": return "inactive";
      case "intakes": return { stage: "intake" };
      case "assessment": return { stage: "assessment" };
      case "psychotherapy": return { stage: "psychotherapy" };
      default: return "";
    }
  }, [activeTab]);

  const queryParams = useMemo(() => ({
    page,
    pageSize,
    search: debouncedSearch,
    status: typeof statusFromTab === "string" ? statusFromTab : filters.status,
    therapistId: filters.therapistId,
    clientType: filters.clientType,
    hasPortalAccess: filters.hasPortalAccess,
    hasPendingTasks: filters.hasPendingTasks,
    sortBy,
    sortOrder,
    currentUserId: user?.id,
    currentUserRole: user?.role,
  }), [page, pageSize, debouncedSearch, statusFromTab, filters, sortBy, sortOrder, user]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/clients", queryParams],
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
      setSelectedClients(data?.clients?.map((c: any) => c.id) || []);
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

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      inactive: "secondary",
      pending: "outline",
    };
    return (
      <Badge variant={variants[status] || "default"}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
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
                <TableHead className="cursor-pointer hover:bg-slate-50" onClick={() => handleSort("status")}>
                  <div className="flex items-center space-x-1">
                    <span>Status</span>
                    <i className={`fas fa-sort${sortBy === "status" ? (sortOrder === "asc" ? "-up" : "-down") : ""} text-slate-400`}></i>
                  </div>
                </TableHead>
                <TableHead>Contact</TableHead>
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
                <TableHead>Session Recency</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: pageSize }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={8} className="text-center py-8">
                      <div className="flex items-center justify-center space-x-2">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span>Loading clients...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : data?.clients?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
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
                      <div className="flex items-center space-x-3">
                        <Avatar className="w-10 h-10">
                          <AvatarFallback className="bg-slate-200 text-slate-600 font-medium text-sm">
                            {getInitials(client.fullName)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p 
                            className="font-medium text-slate-900 cursor-pointer hover:text-primary"
                            onClick={() => onViewClient(client)}
                          >
                            {client.fullName}
                          </p>
                          <p className="text-sm text-slate-500">ID: {client.clientId}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(client.status)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <p className="text-slate-900">{client.phone || 'No phone'}</p>
                        <p className="text-slate-500">{client.email || 'No email'}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 bg-slate-200 rounded-full"></div>
                        <span className="text-sm text-slate-900">
                          {client.assignedTherapist?.fullName || 'Unassigned'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <p className="text-slate-900">
                          {client.lastSessionDate 
                            ? new Date(client.lastSessionDate).toLocaleDateString()
                            : 'No sessions'
                          }
                        </p>
                        <p className="text-slate-500">Individual Therapy</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="w-20">
                        {(() => {
                          const calculateSessionProgress = (lastSessionDate: string | null) => {
                            if (!lastSessionDate) return { percentage: 0, label: "No sessions" };
                            
                            const lastSession = new Date(lastSessionDate);
                            const today = new Date();
                            const daysSinceLastSession = Math.floor((today.getTime() - lastSession.getTime()) / (1000 * 60 * 60 * 24));
                            
                            // Consider sessions within 30 days as 100% (very recent)
                            // Sessions 30-90 days ago decrease linearly from 100% to 25%
                            // Sessions older than 90 days are at 10% (need attention)
                            let percentage;
                            if (daysSinceLastSession <= 30) {
                              percentage = 100;
                            } else if (daysSinceLastSession <= 90) {
                              percentage = Math.max(25, 100 - ((daysSinceLastSession - 30) / 60) * 75);
                            } else {
                              percentage = 10;
                            }
                            
                            return {
                              percentage: Math.round(percentage),
                              label: daysSinceLastSession === 0 ? "Today" : 
                                     daysSinceLastSession === 1 ? "1 day ago" :
                                     daysSinceLastSession < 30 ? `${daysSinceLastSession} days ago` :
                                     daysSinceLastSession < 90 ? `${Math.round(daysSinceLastSession / 7)} weeks ago` :
                                     `${Math.round(daysSinceLastSession / 30)} months ago`
                            };
                          };
                          
                          const progress = calculateSessionProgress(client.lastSessionDate);
                          const progressColor = progress.percentage >= 75 ? "bg-green-500" :
                                              progress.percentage >= 50 ? "bg-yellow-500" :
                                              progress.percentage >= 25 ? "bg-orange-500" : "bg-red-500";
                          
                          return (
                            <>
                              <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                                <span>Recency</span>
                                <span>{progress.percentage}%</span>
                              </div>
                              <Progress 
                                value={progress.percentage} 
                                className={`h-2 [&>div]:${progressColor}`}
                              />
                              <div className="text-xs text-slate-500 mt-1 truncate" title={progress.label}>
                                {progress.label}
                              </div>
                            </>
                          );
                        })()}
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
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => onEditClient(client)}
                          className="p-2 text-slate-600 hover:text-green-600 hover:bg-green-50"
                          title="Edit Client"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => window.location.href = `/scheduling?clientId=${client.id}&clientName=${encodeURIComponent(client.fullName)}&therapistId=${client.assignedTherapist?.id || ''}&therapistName=${encodeURIComponent(client.assignedTherapist?.fullName || '')}`}
                          className="p-2 text-slate-600 hover:text-purple-600 hover:bg-purple-50"
                          title="Schedule Session"
                        >
                          <CalendarDays className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => onDeleteClient(client)}
                          className="p-2 text-slate-600 hover:text-red-600 hover:bg-red-50"
                          title="Delete Client"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
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

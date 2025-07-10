import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Pagination from "./pagination";
import { Client } from "@/types/client";
import { useDebounce } from "@/hooks/use-debounce";

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
}

export default function ClientDataGrid({ 
  activeTab, 
  searchQuery, 
  filters, 
  onViewClient 
}: ClientDataGridProps) {
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
  }), [page, pageSize, debouncedSearch, statusFromTab, filters, sortBy, sortOrder]);

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
                <TableHead>Progress</TableHead>
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
                        <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                          <span>Progress</span>
                          <span>75%</span>
                        </div>
                        <Progress value={75} className="h-2" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => onViewClient(client)}
                          className="p-1 text-slate-600 hover:text-primary hover:bg-primary-50"
                        >
                          <i className="fas fa-eye"></i>
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="p-1 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50"
                        >
                          <i className="fas fa-calendar-plus"></i>
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="p-1 text-slate-600 hover:text-blue-600 hover:bg-blue-50"
                        >
                          <i className="fas fa-envelope"></i>
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                        >
                          <i className="fas fa-ellipsis-h"></i>
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

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface ClientFilterProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
}

export default function ClientFilter({ activeFilter, onFilterChange }: ClientFilterProps) {
  const { user } = useAuth();
  
  const { data: stats = {} } = useQuery({
    queryKey: ["/api/clients/stats", { currentUserId: user?.user?.id || user?.id, currentUserRole: user?.user?.role || user?.role }],
    enabled: !!user && !!(user?.user?.id || user?.id),
    queryFn: async () => {
      const userId = user?.user?.id || user?.id;
      const userRole = user?.user?.role || user?.role;
      const params = new URLSearchParams();
      if (userId) params.append('currentUserId', userId.toString());
      if (userRole) params.append('currentUserRole', userRole);
      
      const response = await fetch(`/api/clients/stats?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
  });

  const filterGroups = [
    {
      label: "📊 Status",
      options: [
        { id: "all", label: "All Clients", count: stats?.totalClients },
        { id: "active", label: "Active", count: stats?.activeClients },
        { id: "inactive", label: "Inactive", count: stats?.inactiveClients },
        { id: "pending", label: "Pending", count: stats?.pendingClients },
      ]
    },
    {
      label: "🎯 Treatment Stage",
      options: [
        { id: "intakes", label: "New Intakes", count: stats?.newIntakes },
        { id: "assessment", label: "Assessment Phase", count: stats?.assessmentPhase },
        { id: "psychotherapy", label: "Psychotherapy", count: stats?.psychotherapy },
      ]
    },
    {
      label: "⚠️ Special Cases",
      options: [
        { id: "follow-up", label: "Follow-up", count: stats?.needsFollowUp },
        { id: "no-sessions", label: "No Sessions", count: stats?.noSessions },
        { id: "unassigned", label: "Unassigned Clients", count: stats?.unassignedClients },
      ]
    },
    {
      label: "✅ Checklist Status",
      options: [
        { id: "checklist-completed", label: "All Checklists Complete", count: stats?.checklistCompleted },
        { id: "checklist-in-progress", label: "Checklists In Progress", count: stats?.checklistInProgress },
        { id: "checklist-not-started", label: "Checklists Not Started", count: stats?.checklistNotStarted },
        { id: "checklist-overdue", label: "Overdue Checklists", count: stats?.checklistOverdue },
      ]
    },
  ];

  const allOptions = filterGroups.flatMap(group => group.options);
  const currentOption = allOptions.find(option => option.id === activeFilter);
  const displayLabel = currentOption ? `${currentOption.label} (${currentOption.count?.toLocaleString() || 0})` : "All Clients";

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 mb-6 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <label className="text-sm font-medium text-slate-700">Filter Clients:</label>
          <Select value={activeFilter} onValueChange={onFilterChange}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={displayLabel} />
            </SelectTrigger>
            <SelectContent>
              {filterGroups.map((group) => (
                <div key={group.label}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                    {group.label}
                  </div>
                  {group.options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <div className="flex items-center justify-between w-full">
                        <span>{option.label}</span>
                        <Badge variant="outline" className="ml-2 text-xs">
                          {option.count?.toLocaleString() || 0}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="text-sm text-slate-600">
          Showing: <span className="font-medium text-slate-900">{displayLabel}</span>
        </div>
      </div>
    </div>
  );
}

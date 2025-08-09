import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuth } from "@/hooks/useAuth";

interface SearchFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters: {
    status: string;
    therapistId: string;
    clientType: string;
    hasPortalAccess?: boolean;
    hasPendingTasks?: boolean;
    hasNoSessions?: boolean;
  };
  onFiltersChange: (filters: any) => void;
}

export default function SearchFilters({ 
  searchQuery, 
  onSearchChange, 
  filters, 
  onFiltersChange 
}: SearchFiltersProps) {
  const { user } = useAuth();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 300);

  const { data: therapists } = useQuery({
    queryKey: ["/api/therapists", { currentUserId: user?.id, currentUserRole: user?.role }],
  });

  const activeFilterCount = Object.values(filters).filter(value => 
    value !== "" && value !== undefined
  ).length;

  const handleFilterChange = (key: string, value: any) => {
    // Convert "all" back to empty string for backend compatibility
    const processedValue = value === "all" ? "" : value;
    onFiltersChange({ ...filters, [key]: processedValue });
  };

  const clearFilters = () => {
    onFiltersChange({
      status: "",
      therapistId: "",
      clientType: "",
      hasPortalAccess: undefined,
      hasPendingTasks: undefined,
      hasNoSessions: undefined,
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 mb-6">
      <div className="p-6">
        <div className="flex items-center space-x-4 mb-4">
          <div className="flex-1 relative">
            <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400"></i>
            <Input
              type="text"
              placeholder="Search by name, email, phone, or client ID..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 pr-4 py-3 w-full"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center space-x-2"
          >
            <i className="fas fa-filter"></i>
            <span>Advanced Filters</span>
            {activeFilterCount > 0 && (
              <Badge variant="secondary">{activeFilterCount}</Badge>
            )}
          </Button>
        </div>

        {showAdvanced && (
          <div className="border-t border-slate-200 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Client Status</label>
                <Select value={filters.status || "all"} onValueChange={(value) => handleFilterChange('status', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Assigned Therapist</label>
                <Select value={filters.therapistId || "all"} onValueChange={(value) => handleFilterChange('therapistId', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Therapists" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Therapists</SelectItem>
                    {therapists?.map((therapist: any) => (
                      <SelectItem key={therapist.id} value={therapist.id.toString()}>
                        {therapist.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Client Type</label>
                <Select value={filters.clientType || "all"} onValueChange={(value) => handleFilterChange('clientType', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="couple">Couple</SelectItem>
                    <SelectItem value="family">Family</SelectItem>
                    <SelectItem value="group">Group</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Date Range</label>
                <Input type="date" />
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2">
                  <Checkbox 
                    checked={filters.hasPortalAccess === true}
                    onCheckedChange={(checked) => 
                      handleFilterChange('hasPortalAccess', checked ? true : undefined)
                    }
                  />
                  <span className="text-sm text-slate-700">Has Portal Access</span>
                </label>
                <label className="flex items-center space-x-2">
                  <Checkbox 
                    checked={filters.hasPendingTasks === true}
                    onCheckedChange={(checked) => 
                      handleFilterChange('hasPendingTasks', checked ? true : undefined)
                    }
                  />
                  <span className="text-sm text-slate-700">Has Pending Tasks</span>
                </label>
                <label className="flex items-center space-x-2">
                  <Checkbox 
                    checked={filters.hasNoSessions === true}
                    onCheckedChange={(checked) => 
                      handleFilterChange('hasNoSessions', checked ? true : undefined)
                    }
                  />
                  <span className="text-sm text-slate-700">No Sessions</span>
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Button variant="ghost" onClick={clearFilters}>
                  Clear Filters
                </Button>
                <Button>Apply Filters</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";
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
    checklistTemplateId?: string;
    checklistItemId?: string;
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

  // Use the optimized batch API - single call instead of 4+ separate calls
  const { data: batchData } = useQuery({
    queryKey: ["/api/client-filters/batch"],
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes since this data rarely changes
    queryFn: async () => {
      const response = await fetch("/api/client-filters/batch");
      if (!response.ok) {
        // Fallback to individual calls if batch fails
        const [therapistsRes, templatesRes, categoriesRes] = await Promise.all([
          fetch("/api/therapists"),
          fetch("/api/checklist-templates"), 
          fetch("/api/system-options/categories")
        ]);
        
        const [therapists, checklistTemplates, categories] = await Promise.all([
          therapistsRes.json(),
          templatesRes.json(),
          categoriesRes.json()
        ]);
        
        // Get client type options
        const clientTypeCategory = categories.find((cat: any) => cat.categoryKey === "client_type");
        let clientTypeOptions = [];
        if (clientTypeCategory) {
          const optionsRes = await fetch(`/api/system-options/categories/${clientTypeCategory.id}`);
          const optionsData = await optionsRes.json();
          clientTypeOptions = optionsData.options || [];
        }
        
        return {
          therapists,
          checklistTemplates,
          systemOptions: {
            client_type: { options: clientTypeOptions }
          }
        };
      }
      return response.json();
    }
  });

  const therapists = batchData?.therapists || [];
  const checklistTemplates = batchData?.checklistTemplates || [];
  const clientTypeOptions = batchData?.systemOptions?.client_type?.options || [];
  
  // Debug: Log the data structure to console for troubleshooting
  console.log('Batch data received:', { 
    therapistsCount: therapists.length, 
    templatesCount: checklistTemplates.length, 
    clientTypeOptionsCount: clientTypeOptions.length,
    sampleClientOption: clientTypeOptions[0]
  });

  // Fetch checklist items for selected template
  const { data: checklistItems = [] } = useQuery<any[]>({
    queryKey: ["/api/checklist-items"],
    enabled: !!filters.checklistTemplateId && filters.checklistTemplateId !== "all",
  });

  // Filter items by selected template
  const filteredChecklistItems = checklistItems.filter((item: any) => 
    !filters.checklistTemplateId || filters.checklistTemplateId === "all" || item.templateId?.toString() === filters.checklistTemplateId
  );

  const activeFilterCount = Object.values(filters).filter(value => 
    value !== "" && value !== undefined
  ).length;

  const handleFilterChange = (key: string, value: any) => {
    // Convert "all" back to empty string for backend compatibility
    const processedValue = value === "all" ? "" : value;
    
    // If changing checklist template, clear the selected item
    if (key === 'checklistTemplateId') {
      onFiltersChange({ ...filters, [key]: processedValue, checklistItemId: "" });
    } else {
      onFiltersChange({ ...filters, [key]: processedValue });
    }
  };

  const clearFilters = () => {
    onFiltersChange({
      status: "",
      therapistId: "",
      clientType: "",
      hasPortalAccess: undefined,
      hasPendingTasks: undefined,
      hasNoSessions: undefined,
      checklistTemplateId: "",
      checklistItemId: "",
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
                <SearchableSelect
                  value={filters.therapistId || "all"}
                  onValueChange={(value) => handleFilterChange('therapistId', value)}
                  options={[
                    { value: "all", label: "All Therapists" },
                    ...(therapists?.map((therapist: any) => ({
                      value: therapist.id.toString(),
                      label: therapist.fullName || therapist.full_name
                    })) || [])
                  ]}
                  placeholder="All Therapists"
                  searchPlaceholder="Search therapists..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Client Type</label>
                <SearchableSelect
                  value={filters.clientType || "all"}
                  onValueChange={(value) => handleFilterChange('clientType', value)}
                  options={[
                    { value: "all", label: "All Types" },
                    ...(clientTypeOptions?.map((option: any) => ({
                      value: option.optionKey || option.optionkey,
                      label: option.optionLabel || option.optionlabel
                    })) || [])
                  ]}
                  placeholder="All Types"
                  searchPlaceholder="Search client types..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Checklist Template</label>
                <SearchableSelect
                  value={filters.checklistTemplateId || "all"}
                  onValueChange={(value) => handleFilterChange('checklistTemplateId', value)}
                  options={[
                    { value: "all", label: "All Templates" },
                    ...(checklistTemplates?.map((template: any) => ({
                      value: template.id?.toString() || "",
                      label: template.name || "Unnamed Template"
                    })) || [])
                  ]}
                  placeholder="All Templates"
                  searchPlaceholder="Search templates..."
                />
              </div>
            </div>

            {/* Second row for checklist items */}
            {filters.checklistTemplateId && filters.checklistTemplateId !== "all" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Checklist Item</label>
                  <SearchableSelect
                    value={filters.checklistItemId || "all"}
                    onValueChange={(value) => handleFilterChange('checklistItemId', value)}
                    options={[
                      { value: "all", label: "All Items" },
                      ...(filteredChecklistItems?.map((item: any) => ({
                        value: item.id?.toString() || "",
                        label: `${item.title || "Untitled"} (${item.category || "uncategorized"})`
                      })) || [])
                    ]}
                    placeholder="All Items"
                    searchPlaceholder="Search checklist items..."
                  />
                </div>
                <div></div>
                <div></div>
                <div></div>
              </div>
            )}

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

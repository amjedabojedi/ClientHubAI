import { useState } from "react";
import { useLocation } from "wouter";

// Icons
import { Download, Upload, Plus, HelpCircle, ChevronDown } from "lucide-react";

// UI Components
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Component Imports
import ClientFilter from "@/components/client-management/client-tabs";
import SearchFilters from "@/components/client-management/search-filters";
import ClientDataGrid from "@/components/client-management/client-data-grid";
import AddClientModal from "@/components/client-management/add-client-modal";
import BulkUploadModal from "@/components/client-management/bulk-upload-modal";
import EditClientModal from "@/components/client-management/edit-client-modal";
import DeleteClientDialog from "@/components/client-management/delete-client-dialog";
import { Client } from "@/types/client";
import { useAuth } from "@/hooks/useAuth";

export default function ClientsPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
  const [isEditClientModalOpen, setIsEditClientModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    stage: "",
    therapistId: "",
    clientType: "",
    hasPortalAccess: undefined as boolean | undefined,
    hasPendingTasks: undefined as boolean | undefined,
    hasNoSessions: undefined as boolean | undefined,
  });

  const handleViewClient = (client: Client) => {
    setLocation(`/clients/${client.id}`);
  };

  const handleEditClient = (client: Client) => {
    setSelectedClient(client);
    setIsEditClientModalOpen(true);
  };

  const handleDeleteClient = (client: Client) => {
    setSelectedClient(client);
    setIsDeleteDialogOpen(true);
  };

  const handleOpenAddClientModal = () => {
    setIsAddClientModalOpen(true);
  };

  const handleCloseAddClientModal = () => {
    setIsAddClientModalOpen(false);
  };

  const handleCloseEditClientModal = () => {
    setSelectedClient(null);
    setIsEditClientModalOpen(false);
  };

  const handleCloseDeleteDialog = () => {
    setSelectedClient(null);
    setIsDeleteDialogOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">

      
      <div className="flex">        
        <main className="flex-1 px-6 py-12">
          <div className="max-w-full">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
                <p className="text-slate-600 mt-1">Manage and organize your client profiles efficiently</p>
              </div>
              <div className="flex items-center space-x-3">
                {user?.role === 'Administrator' && (
                  <>
                    <button 
                      onClick={() => window.open('/api/clients/export', '_blank')}
                      className="flex items-center space-x-2 bg-slate-100 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-200 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export</span>
                    </button>
                    <BulkUploadModal 
                      trigger={
                        <button className="flex items-center space-x-2 bg-slate-100 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-200 transition-colors">
                          <Upload className="w-4 h-4" />
                          <span>Import</span>
                        </button>
                      }
                    />
                  </>
                )}
                <button 
                  onClick={handleOpenAddClientModal}
                  className="flex items-center space-x-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Client</span>
                </button>
              </div>
            </div>

            {/* Help Section */}
            <div className="mb-6 text-sm text-slate-600 space-y-2 bg-slate-50 p-4 rounded-md border border-slate-200">
              <div className="flex items-start gap-2">
                <span className="text-base">💡</span>
                <div>
                  <p className="font-semibold text-slate-700">Client Management Overview</p>
                  <p className="text-xs mt-1">Organize and manage your entire client roster with comprehensive profiles, stage tracking, and powerful search and filtering tools.</p>
                </div>
              </div>
              
              <div className="border-t border-slate-300 pt-2 mt-2">
                <p className="font-medium text-slate-700">How to manage clients:</p>
                <p className="mt-1">• <strong>Adding New Clients:</strong> Click "Add Client" button to create a new client profile. Fill in required information (name, email, contact info) and assign a primary therapist. Use client type to categorize (individual, couples, family, etc.).</p>
                <p>• <strong>Search & Filter:</strong> Use the search bar to find clients by name, email, or phone. Apply filters for stage (intake, assessment, psychotherapy, closed), therapist assignment, client type, portal access, pending tasks, or clients without sessions.</p>
                <p>• <strong>Stage Management:</strong> Use the tabs to filter clients by stage: All, Intake (new referrals), Assessment (evaluation phase), Psychotherapy (active treatment), or Closed (discharged). Move clients through stages as treatment progresses.</p>
                <p>• <strong>Client Profile Actions:</strong> Click any client row to view their full profile. Use the action menu (⋮) on each row to quickly edit client details, schedule appointments, add notes, upload documents, or view billing information.</p>
                <p>• <strong>Bulk Operations (Administrators):</strong> Export all clients to Excel for backup or reporting. Import multiple clients from an Excel template for quick onboarding. The system validates data and prevents duplicates automatically.</p>
              </div>
            </div>

            <ClientFilter 
              activeFilter={activeTab} 
              onFilterChange={(newTab) => {
                setActiveTab(newTab);
                // Sync with SearchFilters stage
                if (["intake", "assessment", "psychotherapy", "closed"].includes(newTab)) {
                  setFilters(prev => ({ ...prev, stage: newTab }));
                } else {
                  setFilters(prev => ({ ...prev, stage: "" }));
                }
              }} 
            />
            
            <SearchFilters 
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filters={filters}
              onFiltersChange={(newFilters) => {
                setFilters(newFilters);
                // Sync activeTab with stage filter
                if (newFilters.stage && ["intake", "assessment", "psychotherapy", "closed"].includes(newFilters.stage)) {
                  setActiveTab(newFilters.stage);
                } else if (!newFilters.stage) {
                  setActiveTab("all");
                }
              }}
            />
            
            <ClientDataGrid 
              activeTab={activeTab}
              searchQuery={searchQuery}
              filters={filters}
              onViewClient={handleViewClient}
              onEditClient={handleEditClient}
              onDeleteClient={handleDeleteClient}
            />
          </div>
        </main>
      </div>

      <AddClientModal 
        isOpen={isAddClientModalOpen}
        onClose={handleCloseAddClientModal}
      />

      {selectedClient && (
        <EditClientModal 
          client={selectedClient}
          isOpen={isEditClientModalOpen}
          onClose={handleCloseEditClientModal}
        />
      )}

      {selectedClient && (
        <DeleteClientDialog 
          client={selectedClient}
          isOpen={isDeleteDialogOpen}
          onClose={handleCloseDeleteDialog}
        />
      )}
    </div>
  );
}

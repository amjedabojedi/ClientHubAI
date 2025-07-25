import { useState } from "react";
import { useLocation } from "wouter";

// Icons
import { Download, Upload, Plus } from "lucide-react";

// Component Imports
import ClientTabs from "@/components/client-management/client-tabs";
import SearchFilters from "@/components/client-management/search-filters";
import ClientDataGrid from "@/components/client-management/client-data-grid";
import AddClientModal from "@/components/client-management/add-client-modal";
import BulkUploadModal from "@/components/client-management/bulk-upload-modal";
import EditClientModal from "@/components/client-management/edit-client-modal";
import DeleteClientDialog from "@/components/client-management/delete-client-dialog";
import { Client } from "@/types/client";

export default function ClientsPage() {
  const [, setLocation] = useLocation();
  const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
  const [isEditClientModalOpen, setIsEditClientModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    status: "",
    therapistId: "",
    clientType: "",
    hasPortalAccess: undefined as boolean | undefined,
    hasPendingTasks: undefined as boolean | undefined,
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
                <button className="flex items-center space-x-2 bg-slate-100 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-200 transition-colors">
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
                <button 
                  onClick={handleOpenAddClientModal}
                  className="flex items-center space-x-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Client</span>
                </button>
              </div>
            </div>

            <ClientTabs activeTab={activeTab} onTabChange={setActiveTab} />
            
            <SearchFilters 
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filters={filters}
              onFiltersChange={setFilters}
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

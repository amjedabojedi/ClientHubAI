import { useState } from "react";
import ClientHeader from "@/components/client-management/client-header";
import ClientSidebar from "@/components/client-management/client-sidebar";
import ClientTabs from "@/components/client-management/client-tabs";
import SearchFilters from "@/components/client-management/search-filters";
import ClientDataGrid from "@/components/client-management/client-data-grid";
import ClientDetailModal from "@/components/client-management/client-detail-modal";
import AddClientModal from "@/components/client-management/add-client-modal";
import { Client } from "@/types/client";

export default function ClientsPage() {
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
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
    setSelectedClient(client);
  };

  const handleCloseModal = () => {
    setSelectedClient(null);
  };

  const handleOpenAddClientModal = () => {
    setIsAddClientModalOpen(true);
  };

  const handleCloseAddClientModal = () => {
    setIsAddClientModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <ClientHeader />
      
      <div className="flex">
        <ClientSidebar />
        
        <main className="flex-1 p-6">
          <div className="max-w-full">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Client Management</h1>
                <p className="text-slate-600 mt-1">Manage and organize your client profiles efficiently</p>
              </div>
              <div className="flex items-center space-x-3">
                <button className="flex items-center space-x-2 bg-slate-100 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-200 transition-colors">
                  <i className="fas fa-download"></i>
                  <span>Export</span>
                </button>
                <button className="flex items-center space-x-2 bg-slate-100 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-200 transition-colors">
                  <i className="fas fa-upload"></i>
                  <span>Import</span>
                </button>
                <button 
                  onClick={handleOpenAddClientModal}
                  className="flex items-center space-x-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
                >
                  <i className="fas fa-plus"></i>
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
            />
          </div>
        </main>
      </div>

      {selectedClient && (
        <ClientDetailModal 
          client={selectedClient} 
          onClose={handleCloseModal}
        />
      )}

      <AddClientModal 
        isOpen={isAddClientModalOpen}
        onClose={handleCloseAddClientModal}
      />
    </div>
  );
}

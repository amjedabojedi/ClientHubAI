import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

interface ClientTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function ClientTabs({ activeTab, onTabChange }: ClientTabsProps) {
  const { user } = useAuth();
  
  const { data: stats = {} } = useQuery({
    queryKey: ["/api/clients/stats", { currentUserId: user?.id, currentUserRole: user?.role }],
    enabled: !!user,
  });

  const tabs = [
    { id: "all", label: "All Clients", icon: "fas fa-users", count: stats?.totalClients },
    { id: "active", label: "Active", icon: "fas fa-user-check", count: stats?.activeClients },
    { id: "inactive", label: "Inactive", icon: "fas fa-user-times", count: stats?.inactiveClients },
    { id: "intakes", label: "New Intakes", icon: "fas fa-user-plus", count: stats?.newIntakes },
    { id: "assessment", label: "Assessment Phase", icon: "fas fa-clipboard-list", count: stats?.assessmentPhase },
    { id: "psychotherapy", label: "Psychotherapy", icon: "fas fa-brain", count: stats?.psychotherapy },
    { id: "no-sessions", label: "No Sessions", icon: "fas fa-calendar-times", count: stats?.noSessions },
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 mb-6">
      <div className="border-b border-slate-200">
        <nav className="flex space-x-8 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center space-x-2 py-4 ${
                activeTab === tab.id
                  ? "border-b-2 border-primary text-primary font-medium"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <i className={tab.icon}></i>
              <span>{tab.label}</span>
              <span 
                className={`text-xs px-2 py-1 rounded-full ${
                  activeTab === tab.id
                    ? "bg-primary-100 text-primary"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {tab.count?.toLocaleString() || 0}
              </span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

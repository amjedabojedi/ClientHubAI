import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LayoutDashboard, Users, Calendar, BookOpen, ClipboardList, CheckSquare, UserCheck, LogOut, User, ChevronDown, Settings, Shield, FileText, Cog, Bell, CreditCard } from "lucide-react";
import NotFound from "@/pages/not-found";
import DashboardPage from "@/pages/dashboard";
import ClientsPage from "@/pages/clients";
import ClientDetailPage from "@/pages/client-detail";
import SchedulingPage from "@/pages/scheduling";
import LibraryPage from "@/pages/library";
import TasksPage from "@/pages/tasks";
import TaskHistoryPage from "@/pages/tasks-history";
import AssessmentsPage from "@/pages/assessments";
import AssessmentCompletionPage from "@/pages/assessment-completion";
import AssessmentReportPage from "@/pages/assessment-report";
import UserProfilesPage from "@/pages/user-profiles-simplified";
import RoleManagementPage from "@/pages/role-management";
import SettingsPage from "@/pages/settings";
import ChecklistManagementPage from "@/pages/checklist-management";
import MyProfilePage from "@/pages/my-profile";
import LoginPage from "@/pages/login";
import NotificationsPage from "@/pages/notifications";
import HIPAAAuditPage from "@/pages/hipaa-audit";
import BillingDashboard from "@/pages/billing-dashboard";
import { AuthContext, useAuth, useAuthState } from "@/hooks/useAuth";
import { RecentItemsProvider } from "@/contexts/RecentItemsContext";
import NotificationBell from "@/components/notifications/notification-bell";
import { PostHogProvider } from "@/lib/posthog";


// Helper function to check if user has admin or supervisor privileges
function isAdminOrSupervisor(user: any): boolean {
  if (!user?.role) return false;
  const normalizedRole = user.role.toLowerCase().trim();
  return ['administrator', 'admin', 'supervisor'].includes(normalizedRole);
}

// Redirect component for old session-notes URL
function SessionNotesRedirect({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  setLocation(`/clients/${params.id}`);
  return null;
}

function Navigation() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  
  // Filter navigation items based on user role
  const getNavItems = () => {
    const baseItems: Array<{
      path: string;
      label: string;
      icon: any;
      submenu?: Array<{ path: string; label: string; icon: any }>;
    }> = [
      { path: "/", label: "Dashboard", icon: LayoutDashboard },
      { path: "/clients", label: "Clients", icon: Users },
      { path: "/scheduling", label: "Scheduling", icon: Calendar },
      { path: "/billing", label: "Billing", icon: CreditCard },
      { path: "/tasks", label: "Tasks", icon: CheckSquare },
    ];

    // Only show Administration menu to supervisors and admins
    if (isAdminOrSupervisor(user)) {
      baseItems.push({
        path: "/administration", 
        label: "Administration", 
        icon: Cog,
        submenu: [
          { path: "/library", label: "Library", icon: BookOpen },
          { path: "/assessments", label: "Assessments", icon: ClipboardList },
          { path: "/checklist-management", label: "Process Checklists", icon: FileText },
          { path: "/user-profiles", label: "User Profiles", icon: UserCheck },
          { path: "/role-management", label: "Role Management", icon: Shield },
          { path: "/notifications", label: "Notifications", icon: Bell },
          { path: "/hipaa-audit", label: "HIPAA Audit", icon: Shield },
          { path: "/settings", label: "Settings", icon: Settings },
        ]
      });
    }

    return baseItems;
  };

  const navItems = getNavItems();

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex items-center h-16">
          <div className="flex items-center space-x-6 flex-1">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">TF</span>
              </div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                TherapyFlow
              </h1>
            </div>
            <div className="flex space-x-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.path || (item.submenu && item.submenu.some(sub => location === sub.path));
                
                if (item.submenu) {
                  return (
                    <DropdownMenu key={item.path}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant={isActive ? "default" : "ghost"}
                          className="flex items-center gap-2 h-9 px-3 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <Icon className="w-4 h-4" />
                          {item.label}
                          <ChevronDown className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {item.submenu.map((subItem) => {
                          const SubIcon = subItem.icon;
                          return (
                            <DropdownMenuItem key={subItem.path} asChild>
                              <Link href={subItem.path} className="flex items-center gap-2 w-full">
                                <SubIcon className="w-4 h-4" />
                                {subItem.label}
                              </Link>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                }
                
                return (
                  <Link key={item.path} href={item.path}>
                    <Button
                      variant={isActive ? "default" : "ghost"}
                      className="flex items-center gap-2 h-9 px-3 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
          
          {user && (
            <div className="flex items-center space-x-2">
              <NotificationBell />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Account
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href="/my-profile" className="flex items-center gap-2 w-full">
                      <User className="w-4 h-4" />
                      My Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={logout}
                    className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  // Wait for authentication to settle before rendering routes
  // This prevents the 404 page from flashing during page refresh
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navigation />
      <main className="py-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Switch key={isAuthenticated ? 'authenticated' : 'unauthenticated'}>
          <Route path="/" component={DashboardPage} />
          <Route path="/clients" component={ClientsPage} />
          <Route path="/clients/:id/session-notes" component={SessionNotesRedirect} />
          <Route path="/clients/:id" component={ClientDetailPage} />
          <Route path="/scheduling" component={SchedulingPage} />
          <Route path="/billing" component={BillingDashboard} />
          <Route path="/billing-dashboard" component={BillingDashboard} />
          <Route path="/tasks" component={TasksPage} />
          <Route path="/tasks/history" component={TaskHistoryPage} />
          <Route path="/library" component={LibraryPage} />
          <Route path="/assessments" component={() => {
            const { user } = useAuth();
            if (isAdminOrSupervisor(user)) {
              return <AssessmentsPage />;
            } else {
              // Redirect therapists to dashboard with a message
              return (
                <div className="max-w-2xl mx-auto mt-8">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <Shield className="h-5 w-5 text-yellow-400" />
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-yellow-800">
                          Access Restricted
                        </h3>
                        <div className="mt-2 text-sm text-yellow-700">
                          <p>Assessment template management is restricted to administrators and supervisors.</p>
                          <p className="mt-2">You can still assign assessments to clients through their individual profiles.</p>
                        </div>
                        <div className="mt-4">
                          <Link href="/clients">
                            <Button variant="outline" size="sm">
                              <Users className="h-4 w-4 mr-2" />
                              Go to Clients
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
          }} />
          <Route path="/assessments/:assignmentId/complete" component={AssessmentCompletionPage} />
          <Route path="/assessments/:assignmentId/report" component={AssessmentReportPage} />
          <Route path="/checklist-management" component={ChecklistManagementPage} />
          <Route path="/user-profiles" component={UserProfilesPage} />
          <Route path="/role-management" component={RoleManagementPage} />
          <Route path="/notifications" component={NotificationsPage} />
          <Route path="/settings" component={() => {
            const { user } = useAuth();
            if (isAdminOrSupervisor(user)) {
              return <SettingsPage />;
            } else {
              // Redirect therapists to dashboard with a message
              return (
                <div className="max-w-2xl mx-auto mt-8">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <Shield className="h-5 w-5 text-yellow-400" />
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-yellow-800">
                          Access Restricted
                        </h3>
                        <div className="mt-2 text-sm text-yellow-700">
                          <p>Settings management is restricted to administrators and supervisors.</p>
                          <p className="mt-2">Please contact your administrator if you need to modify system settings.</p>
                        </div>
                        <div className="mt-4">
                          <Link href="/">
                            <Button variant="outline" size="sm">
                              <LayoutDashboard className="h-4 w-4 mr-2" />
                              Go to Dashboard
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
          }} />
          <Route path="/my-profile" component={MyProfilePage} />
          <Route path="/hipaa-audit" component={HIPAAAuditPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      
      {/* Footer */}
      <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="text-center text-sm text-gray-600 dark:text-gray-400">
            <p>
              TherapyFlow © 2025 powered by{" "}
              <span className="font-medium text-gray-900 dark:text-gray-100">
                Resilience Psychotherapy, Counselling, Consultation, and Research Corp.
              </span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function App() {
  const authState = useAuthState();

  return (
    <QueryClientProvider client={queryClient}>
      <PostHogProvider>
        <TooltipProvider>
          <AuthContext.Provider value={authState}>
            <RecentItemsProvider>
              <Toaster />
              <Router />
            </RecentItemsProvider>
          </AuthContext.Provider>
        </TooltipProvider>
      </PostHogProvider>
    </QueryClientProvider>
  );
}

export default App;

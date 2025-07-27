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
import { LayoutDashboard, Users, Calendar, BookOpen, ClipboardList, CheckSquare, UserCheck, LogOut, User, ChevronDown, Settings, Shield, FileText, Cog } from "lucide-react";
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
import { AuthContext, useAuth, useAuthState } from "@/hooks/useAuth";

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
      { path: "/tasks", label: "Tasks", icon: CheckSquare },
    ];

    // Only show Administration menu to supervisors and admins
    if (user?.role === 'admin' || user?.role === 'supervisor') {
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
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-8">
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
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Welcome, {user.fullName || user.username}
              </span>
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
      <main className="py-8">
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/clients" component={ClientsPage} />
          <Route path="/clients/:id" component={ClientDetailPage} />
          <Route path="/scheduling" component={SchedulingPage} />
          <Route path="/tasks" component={TasksPage} />
          <Route path="/tasks/history" component={TaskHistoryPage} />
          <Route path="/library" component={LibraryPage} />
          <Route path="/assessments" component={AssessmentsPage} />
          <Route path="/assessments/:assignmentId/complete" component={AssessmentCompletionPage} />
          <Route path="/assessments/:assignmentId/report" component={AssessmentReportPage} />
          <Route path="/checklist-management" component={ChecklistManagementPage} />
          <Route path="/user-profiles" component={UserProfilesPage} />
          <Route path="/role-management" component={RoleManagementPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/my-profile" component={MyProfilePage} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  const authState = useAuthState();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthContext.Provider value={authState}>
          <Toaster />
          <Router />
        </AuthContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

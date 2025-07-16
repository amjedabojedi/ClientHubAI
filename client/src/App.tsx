import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Users, Calendar, BookOpen, ClipboardList, CheckSquare, UserCheck, LogOut } from "lucide-react";
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
import UserProfilesPage from "@/pages/user-profiles";
import LoginPage from "@/pages/login";
import { AuthContext, useAuth, useAuthState } from "@/hooks/useAuth";

function Navigation() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  
  const navItems = [
    { path: "/", label: "Dashboard", icon: LayoutDashboard },
    { path: "/clients", label: "Clients", icon: Users },
    { path: "/scheduling", label: "Scheduling", icon: Calendar },
    { path: "/tasks", label: "Tasks", icon: CheckSquare },
    { path: "/library", label: "Library", icon: BookOpen },
    { path: "/assessments", label: "Assessments", icon: ClipboardList },
    { path: "/user-profiles", label: "User Profiles", icon: UserCheck },
  ];

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 pt-8">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-8">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Client Management System
            </h1>
            <div className="flex space-x-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.path;
                
                return (
                  <Link key={item.path} href={item.path}>
                    <Button
                      variant={isActive ? "default" : "ghost"}
                      className="flex items-center gap-2"
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
                Welcome, {user.firstName} {user.lastName}
              </span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={logout}
                className="flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
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
      <main>
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
          <Route path="/user-profiles" component={UserProfilesPage} />
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

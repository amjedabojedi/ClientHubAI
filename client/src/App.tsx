import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Users, Calendar, BookOpen, ClipboardList } from "lucide-react";
import NotFound from "@/pages/not-found";
import ClientsPage from "@/pages/clients";
import ClientDetailPage from "@/pages/client-detail";
import SchedulingPage from "@/pages/scheduling";
import LibraryPage from "@/pages/library";
import AssessmentsPage from "@/pages/assessments";

function Navigation() {
  const [location] = useLocation();
  
  const navItems = [
    { path: "/clients", label: "Clients", icon: Users },
    { path: "/scheduling", label: "Scheduling", icon: Calendar },
    { path: "/library", label: "Library", icon: BookOpen },
    { path: "/assessments", label: "Assessments", icon: ClipboardList },
  ];

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
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
        </div>
      </div>
    </nav>
  );
}

function Router() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navigation />
      <main>
        <Switch>
          <Route path="/" component={ClientsPage} />
          <Route path="/clients" component={ClientsPage} />
          <Route path="/clients/:id" component={ClientDetailPage} />
          <Route path="/scheduling" component={SchedulingPage} />
          <Route path="/library" component={LibraryPage} />
          <Route path="/assessments" component={AssessmentsPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

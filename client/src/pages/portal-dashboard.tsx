import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, FileText, CreditCard, Upload, Clock } from "lucide-react";

export default function PortalDashboardPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-lg">TF</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">TherapyFlow</h1>
                <p className="text-xs text-gray-600">Client Portal</p>
              </div>
            </div>
            <Button variant="outline" data-testid="button-portal-logout">
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome Back!</h2>
          <p className="text-gray-600">Manage your appointments, billing, and documents all in one place.</p>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer" data-testid="card-book-appointment">
            <CardHeader>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                <Calendar className="w-6 h-6 text-blue-600" />
              </div>
              <CardTitle className="text-lg">Book Appointment</CardTitle>
              <CardDescription>Schedule a new session</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full">View Available Times</Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" data-testid="card-view-invoices">
            <CardHeader>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                <CreditCard className="w-6 h-6 text-purple-600" />
              </div>
              <CardTitle className="text-lg">View Invoices</CardTitle>
              <CardDescription>Check billing history</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">View Billing</Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" data-testid="card-upload-documents">
            <CardHeader>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                <Upload className="w-6 h-6 text-green-600" />
              </div>
              <CardTitle className="text-lg">Upload Documents</CardTitle>
              <CardDescription>Share insurance & forms</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">Upload Files</Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow cursor-pointer" data-testid="card-view-appointments">
            <CardHeader>
              <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center mb-3">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
              <CardTitle className="text-lg">My Appointments</CardTitle>
              <CardDescription>View upcoming sessions</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">View Schedule</Button>
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Appointments */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Upcoming Appointments</CardTitle>
            <CardDescription>Your scheduled therapy sessions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12 text-gray-500">
              <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-sm">No upcoming appointments</p>
              <p className="text-xs">Book a new session to get started</p>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Your recent portal actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-sm">No recent activity</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

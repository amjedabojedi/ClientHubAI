import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Client } from "@/types/client";

interface ClientDetailModalProps {
  client: Client;
  onClose: () => void;
}

export default function ClientDetailModal({ client, onClose }: ClientDetailModalProps) {
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch system options for client type dropdown
  const { data: systemOptions = [] } = useQuery<any[]>({
    queryKey: ["/api/system-options/categories"],
  });

  // Get client type options from system options
  const clientTypeCategory = systemOptions?.find?.((cat: any) => cat.categoryKey === "client_type");
  const { data: clientTypeOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${clientTypeCategory?.id}`],
    enabled: !!clientTypeCategory?.id,
  });

  // Get gender options from system options  
  const genderCategory = systemOptions?.find?.((cat: any) => cat.categoryKey === "gender");
  const { data: genderOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${genderCategory?.id}`],
    enabled: !!genderCategory?.id,
  });

  // Get preferred language options from system options
  const languageCategory = systemOptions?.find?.((cat: any) => cat.categoryKey === "preferred_language");
  const { data: languageOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${languageCategory?.id}`],
    enabled: !!languageCategory?.id,
  });

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      inactive: "secondary",
      pending: "outline",
    };
    return (
      <Badge variant={variants[status] || "default"}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Avatar className="w-16 h-16">
                <AvatarFallback className="bg-slate-200 text-slate-600 font-bold text-xl">
                  {getInitials(client.fullName)}
                </AvatarFallback>
              </Avatar>
              <div>
                <DialogTitle className="text-2xl font-bold text-slate-900">
                  {client.fullName}
                </DialogTitle>
                <p className="text-slate-600">Ref: {client.referenceNumber}</p>
                <div className="flex items-center space-x-2 mt-1">
                  {getStatusBadge(client.status || 'pending')}
                  <span className="text-slate-400">•</span>
                  <span className="text-sm text-slate-600">
                    {client.assignedTherapist?.fullName || 'Unassigned'}
                  </span>
                </div>
              </div>
            </div>
            <Button variant="ghost" onClick={onClose}>
              <i className="fas fa-times text-2xl"></i>
            </Button>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-8">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="assessments">Assessments</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="messages">Messages</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-slate-50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Personal Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Full Name</Label>
                      <Input value={client.fullName} />
                    </div>
                    <div>
                      <Label>Date of Birth</Label>
                      <Input 
                        type="date" 
                        value={client.dateOfBirth ? client.dateOfBirth.split('T')[0] : ''} 
                      />
                    </div>
                    <div>
                      <Label>Phone Number</Label>
                      <Input value={client.phone || ''} />
                    </div>
                    <div>
                      <Label>Email Address</Label>
                      <Input type="email" value={client.email || ''} />
                    </div>
                    <div>
                      <Label>Gender Identity</Label>
                      <Select value={client.gender || ''}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          {genderOptions.options?.filter((option: any) => (option.optionKey || option.optionkey) && (option.optionKey || option.optionkey).trim() !== '').map((option: any) => (
                            <SelectItem key={option.optionKey || option.optionkey} value={option.optionKey || option.optionkey}>
                              {option.optionLabel || option.optionlabel}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Preferred Language</Label>
                      <Select value={client.preferredLanguage || ''}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select language" />
                        </SelectTrigger>
                        <SelectContent>
                          {languageOptions.options?.filter((option: any) => (option.optionKey || option.optionkey) && (option.optionKey || option.optionkey).trim() !== '').map((option: any) => (
                            <SelectItem key={option.optionKey || option.optionkey} value={option.optionKey || option.optionkey}>
                              {option.optionLabel || option.optionlabel}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Emergency Contact</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>Contact Name</Label>
                      <Input value={client.emergencyContactName || ''} />
                    </div>
                    <div>
                      <Label>Phone Number</Label>
                      <Input value={client.emergencyContactPhone || ''} />
                    </div>
                    <div>
                      <Label>Relationship</Label>
                      <Input value={client.emergencyContactRelationship || ''} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-slate-50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Client Status</h3>
                  <div className="space-y-4">
                    <div>
                      <Label>Current Status</Label>
                      <Select value={client.status || ''}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Current Stage</Label>
                      <Select value={client.stage || ''}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="psychotherapy">Psychotherapy</SelectItem>
                          <SelectItem value="assessment">Assessment</SelectItem>
                          <SelectItem value="intake">Intake</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Client Type</Label>
                      <Select value={client.clientType || ''}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {clientTypeOptions.options?.filter((option: any) => (option.optionKey || option.optionkey) && (option.optionKey || option.optionkey).trim() !== '').map((option: any) => (
                            <SelectItem key={option.optionKey || option.optionkey} value={option.optionKey || option.optionkey}>
                              {option.optionLabel || option.optionlabel}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Portal Access</Label>
                      <div className="flex items-center space-x-2 mt-2">
                        <Checkbox checked={client.hasPortalAccess || false} />
                        <span className="text-sm text-slate-700">Enabled</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Insurance Information</h3>
                  <div className="space-y-4">
                    <div>
                      <Label>Primary Insurance</Label>
                      <Input value={client.insuranceProvider || ''} />
                    </div>
                    <div>
                      <Label>Policy Number</Label>
                      <Input value={client.policyNumber || ''} />
                    </div>
                    <div>
                      <Label>Copay Amount</Label>
                      <Input value={client.copayAmount || ''} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sessions" className="mt-6">
            <div className="text-center py-8">
              <i className="fas fa-calendar-alt text-4xl text-slate-400 mb-4"></i>
              <p className="text-slate-600">Session management will be implemented in a future update.</p>
            </div>
          </TabsContent>

          <TabsContent value="assessments" className="mt-6">
            <div className="text-center py-8">
              <i className="fas fa-clipboard-list text-4xl text-slate-400 mb-4"></i>
              <p className="text-slate-600">Assessment management will be implemented in a future update.</p>
            </div>
          </TabsContent>

          <TabsContent value="documents" className="mt-6">
            <div className="text-center py-8">
              <i className="fas fa-file-alt text-4xl text-slate-400 mb-4"></i>
              <p className="text-slate-600">Document management will be implemented in a future update.</p>
            </div>
          </TabsContent>

          <TabsContent value="tasks" className="mt-6">
            <div className="text-center py-8">
              <i className="fas fa-tasks text-4xl text-slate-400 mb-4"></i>
              <p className="text-slate-600">Task management will be implemented in a future update.</p>
            </div>
          </TabsContent>

          <TabsContent value="notes" className="mt-6">
            <div className="text-center py-8">
              <i className="fas fa-sticky-note text-4xl text-slate-400 mb-4"></i>
              <p className="text-slate-600">Notes management will be implemented in a future update.</p>
            </div>
          </TabsContent>

          <TabsContent value="billing" className="mt-6">
            <div className="text-center py-8">
              <i className="fas fa-dollar-sign text-4xl text-slate-400 mb-4"></i>
              <p className="text-slate-600">Billing management will be implemented in a future update.</p>
            </div>
          </TabsContent>

          <TabsContent value="messages" className="mt-6">
            <div className="text-center py-8">
              <i className="fas fa-envelope text-4xl text-slate-400 mb-4"></i>
              <p className="text-slate-600">Message management will be implemented in a future update.</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

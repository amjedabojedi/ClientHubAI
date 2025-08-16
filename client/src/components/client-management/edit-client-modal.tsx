import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { insertClientSchema } from "@shared/schema";
import { Client } from "@/types/client";

// Use insert schema but make clientId optional for edits since it already exists
const clientFormSchema = insertClientSchema.extend({
  assignedTherapistId: z.number().optional(),
  emailNotifications: z.boolean().optional(),
}).partial();

type ClientFormData = z.infer<typeof clientFormSchema>;

interface EditClientModalProps {
  client: Client;
  isOpen: boolean;
  onClose: () => void;
}

export default function EditClientModal({ client, isOpen, onClose }: EditClientModalProps) {
  const [activeTab, setActiveTab] = useState("personal");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: therapists = [] } = useQuery<any[]>({
    queryKey: ["/api/therapists"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Fetch client sessions to get first session date
  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: [`/api/clients/${client.id}/sessions`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!client.id,
  });

  // Fetch system options for dropdowns
  const { data: systemOptions = [] } = useQuery<any[]>({
    queryKey: ["/api/system-options/categories"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Get client type options from system options
  const clientTypeCategory = systemOptions?.find?.((cat: any) => cat.categoryKey === "client_type");
  const { data: clientTypeOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${clientTypeCategory?.id}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!clientTypeCategory?.id,
  });

  const form = useForm<ClientFormData>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      // Personal Information
      fullName: "",
      dateOfBirth: "",
      gender: "prefer_not_to_say",
      maritalStatus: "",
      preferredLanguage: "English",
      pronouns: "",
      emailNotifications: true,
      
      // Portal Access
      hasPortalAccess: false,
      portalEmail: "",
      
      // Contact & Address
      phone: "",
      emergencyPhone: "",
      email: "",
      streetAddress1: "",
      streetAddress2: "",
      city: "",
      province: "",
      postalCode: "",
      country: "United States",
      
      // Referral & Case
      startDate: "",
      referrerName: "",
      referralDate: "",
      referenceNumber: "",
      clientSource: "",
      
      // Employment & Socioeconomic
      employmentStatus: "",
      educationLevel: "",
      dependents: undefined,
      
      // Status & Progress
      clientType: "",
      status: "pending",
      stage: "intake",
      assignedTherapistId: undefined,
      
      // Insurance
      insuranceProvider: "",
      policyNumber: "",
      groupNumber: "",
      insurancePhone: "",
      copayAmount: "",
      deductible: "",
      
      // Service
      serviceType: "",
      serviceFrequency: "",
      
      // Additional
      notes: "",
      
      // Legacy fields
      address: "",
      state: "",
      zipCode: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelationship: "",
      referralSource: "",
      referralType: "",
      referringPerson: "",
      referralNotes: "",
    },
  });

  // Track the last client ID and sessions count to avoid unnecessary resets
  const lastResetRef = useRef<{ clientId: number | null; sessionsCount: number }>({ clientId: null, sessionsCount: 0 });

  // Reset form when client changes or sessions load
  useEffect(() => {
    if (client && (lastResetRef.current.clientId !== client.id || lastResetRef.current.sessionsCount !== sessions.length)) {
      // Calculate first session date
      const firstSessionDate = sessions.length > 0 
        ? new Date(Math.min(...sessions.map((s: any) => new Date(s.sessionDate).getTime())))
            .toISOString().split('T')[0]
        : client.startDate || "";
      
      form.reset({
        // Personal Information
        fullName: client.fullName || "",
        dateOfBirth: client.dateOfBirth || "",
        gender: client.gender || "prefer_not_to_say",
        maritalStatus: client.maritalStatus || "",
        preferredLanguage: client.preferredLanguage || "English",
        pronouns: client.pronouns || "",
        emailNotifications: client.emailNotifications ?? true,
        
        // Portal Access
        hasPortalAccess: client.hasPortalAccess ?? false,
        portalEmail: client.portalEmail || "",
        
        // Contact & Address
        phone: client.phone || "",
        emergencyPhone: client.emergencyPhone || "",
        email: client.email || "",
        streetAddress1: client.streetAddress1 || "",
        streetAddress2: client.streetAddress2 || "",
        city: client.city || "",
        province: client.province || "",
        postalCode: client.postalCode || "",
        country: client.country || "United States",
        
        // Referral & Case
        startDate: firstSessionDate,
        referrerName: client.referrerName || "",
        referralDate: client.referralDate || "",
        referenceNumber: client.referenceNumber || "",
        clientSource: client.clientSource || "",
        
        // Employment & Socioeconomic
        employmentStatus: client.employmentStatus || "",
        educationLevel: client.educationLevel || "",
        dependents: client.dependents || undefined,
        
        // Status & Progress
        clientType: client.clientType || "",
        status: client.status || "pending",
        stage: client.stage || "intake",
        assignedTherapistId: client.assignedTherapistId || undefined,
        
        // Insurance
        insuranceProvider: client.insuranceProvider || "",
        policyNumber: client.policyNumber || "",
        groupNumber: client.groupNumber || "",
        insurancePhone: client.insurancePhone || "",
        copayAmount: client.copayAmount || "",
        deductible: client.deductible || "",
        
        // Service
        serviceType: client.serviceType || "",
        serviceFrequency: client.serviceFrequency || "",
        
        // Additional
        notes: client.notes || "",
        
        // Legacy fields
        address: client.address || "",
        state: client.state || "",
        zipCode: client.zipCode || "",
        emergencyContactName: client.emergencyContactName || "",
        emergencyContactPhone: client.emergencyContactPhone || "",
        emergencyContactRelationship: client.emergencyContactRelationship || "",
        referralSource: client.referralSource || "",
        referralType: client.referralType || "",
        referringPerson: client.referringPerson || "",
        referralNotes: client.referralNotes || "",
      });
      
      // Update the ref to track the current reset
      lastResetRef.current = { clientId: client.id, sessionsCount: sessions.length };
    }
  }, [client, sessions.length, form]);

  const updateClientMutation = useMutation({
    mutationFn: (data: ClientFormData) => 
      apiRequest(`/api/clients/${client.id}`, "PUT", data),
    onSuccess: async (response) => {
      // Invalidate and refetch queries to ensure fresh data
      await queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/clients/${client.id}`] });
      
      toast({
        title: "Success",
        description: "Client updated successfully",
      });
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update client",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ClientFormData) => {
    // Clean up the data before submission
    const processedData = {
      ...data,
      assignedTherapistId: data.assignedTherapistId || undefined,
      dependents: data.dependents || undefined,
      // Handle numeric fields properly - keep zero values but remove empty strings
      copayAmount: data.copayAmount === "" ? undefined : data.copayAmount,
      deductible: data.deductible === "" ? undefined : data.deductible,
      // Don't include clientId in updates since it's auto-generated
      clientId: undefined,
    };
    
    updateClientMutation.mutate(processedData);
  };

  const handleClose = () => {
    form.reset();
    setActiveTab("personal");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Client - {client?.fullName}</DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="personal">Personal</TabsTrigger>
                <TabsTrigger value="contact">Contact</TabsTrigger>
                <TabsTrigger value="referral">Referral</TabsTrigger>
                <TabsTrigger value="employment">Employment</TabsTrigger>
                <TabsTrigger value="clinical">Clinical</TabsTrigger>
              </TabsList>

              {/* Personal Information Tab */}
              <TabsContent value="personal" className="space-y-4 mt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Personal Information</h3>
                
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Enter full name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="dateOfBirth"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date of Birth</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="gender"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Gender</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                            <SelectItem value="non_binary">Non-binary</SelectItem>
                            <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="maritalStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Marital Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="single">Single</SelectItem>
                            <SelectItem value="married">Married</SelectItem>
                            <SelectItem value="divorced">Divorced</SelectItem>
                            <SelectItem value="widowed">Widowed</SelectItem>
                            <SelectItem value="separated">Separated</SelectItem>
                            <SelectItem value="domestic_partnership">Domestic Partnership</SelectItem>
                            <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="pronouns"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pronouns</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., he/him, she/her, they/them" value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="preferredLanguage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Preferred Language</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="English">English</SelectItem>
                          <SelectItem value="Spanish">Spanish</SelectItem>
                          <SelectItem value="French">French</SelectItem>
                          <SelectItem value="Chinese">Chinese</SelectItem>
                          <SelectItem value="Korean">Korean</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="emailNotifications"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Email Notifications</FormLabel>
                        <p className="text-sm text-muted-foreground">
                          Client wants to receive email updates
                        </p>
                      </div>
                    </FormItem>
                  )}
                />

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Client Portal Access</h4>
                  
                  <FormField
                    control={form.control}
                    name="hasPortalAccess"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 mb-4">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Enable Portal Access</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            Allow client to access online portal
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />

                  {form.watch("hasPortalAccess") && (
                    <FormField
                      control={form.control}
                      name="portalEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Portal Email</FormLabel>
                          <FormControl>
                            <Input {...field} type="email" placeholder="portal@example.com" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </TabsContent>

              {/* Contact & Address Tab */}
              <TabsContent value="contact" className="space-y-4 mt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Contact & Address Information</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Primary Phone</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="555-0123" value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="emergencyPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Phone</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="555-0456" value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" placeholder="client@example.com" value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Address Information</h4>
                  
                  <FormField
                    control={form.control}
                    name="streetAddress1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address 1</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="123 Main Street" value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="streetAddress2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address 2 (Optional)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Apt, Unit, or Suite" value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="City name" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="province"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State/Province</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="CA, NY, etc." value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="postalCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Postal/Zip Code</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="12345 or A1B 2C3" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="country"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Country</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="United States" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Emergency Contact</h4>
                  
                  <FormField
                    control={form.control}
                    name="emergencyContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Contact person name" value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="emergencyContactPhone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Emergency Contact Phone</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="555-0789" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="emergencyContactRelationship"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Relationship</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Spouse, Parent, etc." value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Clinical Status & Progress Tab */}
              <TabsContent value="clinical" className="space-y-4 mt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Client Status & Progress</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="clientType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {clientTypeOptions?.options?.map?.((option: any) => (
                              <SelectItem key={option.id} value={option.optionKey}>
                                {option.optionLabel}
                              </SelectItem>
                            )) || []}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="stage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Stage</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="intake">Intake</SelectItem>
                            <SelectItem value="assessment">Assessment</SelectItem>
                            <SelectItem value="psychotherapy">Psychotherapy</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="assignedTherapistId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigned Therapist</FormLabel>
                        <Select onValueChange={(value) => field.onChange(value === "unassigned" ? undefined : parseInt(value))}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select therapist" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {therapists?.map?.((therapist: any) => (
                              <SelectItem key={therapist.id} value={therapist.id.toString()}>
                                {therapist.fullName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Service Type & Frequency</h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="serviceType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Service Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Treatment service details" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="psychotherapy">Psychotherapy</SelectItem>
                              <SelectItem value="counseling">Counseling</SelectItem>
                              <SelectItem value="assessment">Assessment</SelectItem>
                              <SelectItem value="consultation">Consultation</SelectItem>
                              <SelectItem value="group_therapy">Group Therapy</SelectItem>
                              <SelectItem value="family_therapy">Family Therapy</SelectItem>
                              <SelectItem value="couples_therapy">Couples Therapy</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="serviceFrequency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Service Frequency</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Frequency of treatment" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="weekly">Weekly</SelectItem>
                              <SelectItem value="biweekly">Bi-weekly</SelectItem>
                              <SelectItem value="monthly">Monthly</SelectItem>
                              <SelectItem value="as_needed">As Needed</SelectItem>
                              <SelectItem value="intensive">Intensive (Multiple per week)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Insurance Information</h4>
                  
                  <FormField
                    control={form.control}
                    name="insuranceProvider"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Insurance Provider</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., Blue Cross, Aetna" value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="policyNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Policy Number</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Policy number" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="groupNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Group Number</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Group number" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="copayAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Copay Amount</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="number" 
                              step="0.01" 
                              min="0" 
                              placeholder="25.00"
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="deductible"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Deductible</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="number" 
                              step="0.01" 
                              min="0" 
                              placeholder="500.00"
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="insurancePhone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Insurance Phone</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="1-800-123-4567" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Additional Notes</h4>
                  
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Clinical Notes</FormLabel>
                        <FormControl>
                          <Textarea 
                            {...field} 
                            placeholder="Important notes, observations, or special considerations for this client..."
                            className="min-h-[100px]"
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              {/* Referral & Case Information Tab */}
              <TabsContent value="referral" className="space-y-4 mt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Referral & Case Information</h3>
                
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date (First Session)</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Referral Details</h4>
                  
                  <FormField
                    control={form.control}
                    name="referrerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Referrer Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Who referred this client" value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="referralDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Referral Date</FormLabel>
                          <FormControl>
                            <Input {...field} type="date" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="referenceNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Reference Number</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="REF-12345" value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="clientSource"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Source</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="How did the client find us?" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="self_referral">Self-referral</SelectItem>
                            <SelectItem value="physician_referral">Physician Referral</SelectItem>
                            <SelectItem value="insurance_referral">Insurance Referral</SelectItem>
                            <SelectItem value="online_search">Online Search</SelectItem>
                            <SelectItem value="friend_family">Friend/Family Referral</SelectItem>
                            <SelectItem value="employee_assistance">Employee Assistance Program</SelectItem>
                            <SelectItem value="advertisement">Advertisement</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="referralNotes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Referral Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder="Additional referral information..." value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              {/* Employment & Socioeconomic Tab */}
              <TabsContent value="employment" className="space-y-4 mt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Employment & Socioeconomic Information</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="employmentStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employment Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Current employment status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="employed_full_time">Employed Full-time</SelectItem>
                            <SelectItem value="employed_part_time">Employed Part-time</SelectItem>
                            <SelectItem value="self_employed">Self-employed</SelectItem>
                            <SelectItem value="unemployed">Unemployed</SelectItem>
                            <SelectItem value="student">Student</SelectItem>
                            <SelectItem value="retired">Retired</SelectItem>
                            <SelectItem value="disabled">Disabled</SelectItem>
                            <SelectItem value="homemaker">Homemaker</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="educationLevel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Education Level</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Highest education completed" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="elementary">Elementary School</SelectItem>
                            <SelectItem value="high_school">High School</SelectItem>
                            <SelectItem value="some_college">Some College</SelectItem>
                            <SelectItem value="associates">Associate's Degree</SelectItem>
                            <SelectItem value="bachelors">Bachelor's Degree</SelectItem>
                            <SelectItem value="masters">Master's Degree</SelectItem>
                            <SelectItem value="doctorate">Doctorate</SelectItem>
                            <SelectItem value="trade_school">Trade/Technical School</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="dependents"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Number of Dependents</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          min="0" 
                          placeholder="0"
                          value={field.value || ""}
                          onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>
            </Tabs>

            <div className="flex justify-end space-x-4 pt-6 border-t">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={updateClientMutation.isPending}
                className="min-w-[120px]"

              >
                {updateClientMutation.isPending ? "Updating..." : "Update Client"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { insertClientSchema } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { trackEvent } from "@/lib/posthog";
import { useAuth } from "@/hooks/useAuth";

interface AddClientModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const clientFormSchema = insertClientSchema.extend({
  assignedTherapistId: z.number().optional(),
}).refine(
  (data) => {
    // Validate start date is not in the future
    if (data.startDate) {
      const startDate = new Date(data.startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return startDate <= today;
    }
    return true;
  },
  {
    message: "Start date cannot be in the future",
    path: ["startDate"],
  }
).refine(
  (data) => {
    // Validate referral date is before or equal to start date
    if (data.referralDate && data.startDate) {
      const referralDate = new Date(data.referralDate);
      const startDate = new Date(data.startDate);
      return referralDate <= startDate;
    }
    return true;
  },
  {
    message: "Referral date must be before or equal to start date",
    path: ["startDate"],
  }
);

type ClientFormData = z.infer<typeof clientFormSchema>;

export default function AddClientModal({ isOpen, onClose }: AddClientModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  // Fetch therapists and system options - using individual calls for better type safety
  const { data: therapists = [] } = useQuery<any[]>({
    queryKey: ["/api/therapists"],
    staleTime: 5 * 60 * 1000,
  });

  // Fetch system option categories
  const { data: systemCategories = [] } = useQuery<any[]>({
    queryKey: ["/api/system-options/categories"],
    staleTime: 5 * 60 * 1000,
  });

  // Get individual category options with proper typing
  const clientTypeCategory = systemCategories.find((cat: any) => cat.categoryKey === "client_type");
  const referralSourceCategory = systemCategories.find((cat: any) => cat.categoryKey === "referral_sources");
  const maritalStatusCategory = systemCategories.find((cat: any) => cat.categoryKey === "marital_status");
  const employmentStatusCategory = systemCategories.find((cat: any) => cat.categoryKey === "employment_status");
  const educationLevelCategory = systemCategories.find((cat: any) => cat.categoryKey === "education_level");
  const genderCategory = systemCategories.find((cat: any) => cat.categoryKey === "gender");
  const preferredLanguageCategory = systemCategories.find((cat: any) => cat.categoryKey === "preferred_language");

  const { data: clientTypeOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${clientTypeCategory?.id}`],
    enabled: !!clientTypeCategory?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: referralSourceOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${referralSourceCategory?.id}`],
    enabled: !!referralSourceCategory?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: maritalStatusOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${maritalStatusCategory?.id}`],
    enabled: !!maritalStatusCategory?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: employmentStatusOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${employmentStatusCategory?.id}`],
    enabled: !!employmentStatusCategory?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: educationLevelOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${educationLevelCategory?.id}`],
    enabled: !!educationLevelCategory?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: genderOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${genderCategory?.id}`],
    enabled: !!genderCategory?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: preferredLanguageOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${preferredLanguageCategory?.id}`],
    enabled: !!preferredLanguageCategory?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Get client stage category and fetch its options
  const clientStageCategory = systemCategories.find((cat: any) => cat.categoryKey === "client_stage");
  const { data: clientStageOptions = { options: [] } } = useQuery<{ options: any[] }>({
    queryKey: [`/api/system-options/categories/${clientStageCategory?.id}`],
    enabled: !!clientStageCategory?.id,
    staleTime: 5 * 60 * 1000,
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
      assignedTherapistId: user?.role === "therapist" ? user.id : undefined,
      
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

  const createClientMutation = useMutation({
    mutationFn: (data: ClientFormData) => apiRequest("/api/clients", "POST", data),
    onSuccess: (response, variables) => {
      // Track client creation event
      trackEvent('client_created', {
        clientType: variables.clientType,
        hasPortalAccess: variables.hasPortalAccess,
        stage: variables.stage,
        status: variables.status,
      });
      
      toast({
        title: "Success",
        description: "Client created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients/stats"] });
      form.reset();
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create client",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ClientFormData) => {
    // Clean the data to handle null values and empty strings properly
    const processedData = {
      ...data,
      assignedTherapistId: data.assignedTherapistId || undefined,
      // Convert null/empty strings to undefined to prevent server issues
      dateOfBirth: data.dateOfBirth && data.dateOfBirth.trim() ? data.dateOfBirth : undefined,
      gender: data.gender && data.gender.trim() ? data.gender : undefined,
      maritalStatus: data.maritalStatus && data.maritalStatus.trim() ? data.maritalStatus : undefined,
      pronouns: data.pronouns && data.pronouns.trim() ? data.pronouns : undefined,
      portalEmail: data.portalEmail && data.portalEmail.trim() ? data.portalEmail : undefined,
      emergencyPhone: data.emergencyPhone && data.emergencyPhone.trim() ? data.emergencyPhone : undefined,
      streetAddress1: data.streetAddress1 && data.streetAddress1.trim() ? data.streetAddress1 : undefined,
      streetAddress2: data.streetAddress2 && data.streetAddress2.trim() ? data.streetAddress2 : undefined,
      city: data.city && data.city.trim() ? data.city : undefined,
      province: data.province && data.province.trim() ? data.province : undefined,
      postalCode: data.postalCode && data.postalCode.trim() ? data.postalCode : undefined,
      country: data.country && data.country.trim() ? data.country : undefined,
      notes: data.notes && data.notes.trim() ? data.notes : undefined,
      phone: data.phone && data.phone.trim() ? data.phone : undefined,
      email: data.email && data.email.trim() ? data.email : undefined,
      insuranceProvider: data.insuranceProvider && data.insuranceProvider.trim() ? data.insuranceProvider : undefined,
      policyNumber: data.policyNumber && data.policyNumber.trim() ? data.policyNumber : undefined,
      groupNumber: data.groupNumber && data.groupNumber.trim() ? data.groupNumber : undefined,
      copayAmount: data.copayAmount && data.copayAmount.trim() ? data.copayAmount : undefined,
      deductible: data.deductible && data.deductible.trim() ? data.deductible : undefined,
      insurancePhone: data.insurancePhone && data.insurancePhone.trim() ? data.insurancePhone : undefined,
      // Date fields - critical to handle empty strings properly
      startDate: data.startDate && data.startDate.trim() ? data.startDate : undefined,
      referralDate: data.referralDate && data.referralDate.trim() ? data.referralDate : undefined,
      // Other text fields
      referrerName: data.referrerName && data.referrerName.trim() ? data.referrerName : undefined,
      referenceNumber: data.referenceNumber && data.referenceNumber.trim() ? data.referenceNumber : undefined,
      clientSource: data.clientSource && data.clientSource.trim() ? data.clientSource : undefined,
      employmentStatus: data.employmentStatus && data.employmentStatus.trim() ? data.employmentStatus : undefined,
      educationLevel: data.educationLevel && data.educationLevel.trim() ? data.educationLevel : undefined,
      serviceType: data.serviceType && data.serviceType.trim() ? data.serviceType : undefined,
      serviceFrequency: data.serviceFrequency && data.serviceFrequency.trim() ? data.serviceFrequency : undefined,
      referralSource: data.referralSource && data.referralSource.trim() ? data.referralSource : undefined,
      referralType: data.referralType && data.referralType.trim() ? data.referralType : undefined,
      referringPerson: data.referringPerson && data.referringPerson.trim() ? data.referringPerson : undefined,
      referralNotes: data.referralNotes && data.referralNotes.trim() ? data.referralNotes : undefined,
      // Legacy fields
      address: data.address && data.address.trim() ? data.address : undefined,
      state: data.state && data.state.trim() ? data.state : undefined,
      zipCode: data.zipCode && data.zipCode.trim() ? data.zipCode : undefined,
      emergencyContactName: data.emergencyContactName && data.emergencyContactName.trim() ? data.emergencyContactName : undefined,
      emergencyContactPhone: data.emergencyContactPhone && data.emergencyContactPhone.trim() ? data.emergencyContactPhone : undefined,
      emergencyContactRelationship: data.emergencyContactRelationship && data.emergencyContactRelationship.trim() ? data.emergencyContactRelationship : undefined,
    };
    
    createClientMutation.mutate(processedData);
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Tabs defaultValue="personal" className="w-full">
              <TabsList className="grid w-full grid-cols-5 text-xs">
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
                          <Input {...field} type="date" />
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
                        <FormLabel>Gender Options</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value || ""}
                            onValueChange={field.onChange}
                            options={genderOptions.options.map((option: any) => ({
                              value: option.optionKey || option.optionkey,
                              label: option.optionLabel || option.optionlabel
                            }))}
                            placeholder="Select gender"
                            searchPlaceholder="Search gender options..."
                          />
                        </FormControl>
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
                        <FormControl>
                          <SearchableSelect
                            value={field.value || ""}
                            onValueChange={field.onChange}
                            options={maritalStatusOptions.options.map((option: any) => ({
                              value: option.optionKey || option.optionkey,
                              label: option.optionLabel || option.optionlabel
                            }))}
                            placeholder="Select status"
                            searchPlaceholder="Search marital status..."
                          />
                        </FormControl>
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
                          <Input {...field} placeholder="e.g., he/him, she/her, they/them" />
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
                      <FormLabel>Preferred Languages</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onValueChange={field.onChange}
                          options={preferredLanguageOptions.options.map((option: any) => ({
                            value: option.optionKey || option.optionkey,
                            label: option.optionLabel || option.optionlabel
                          }))}
                          placeholder="Select language"
                          searchPlaceholder="Search languages..."
                        />
                      </FormControl>
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
                            Client will use their primary email address for portal login
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              {/* Clinical Status & Progress Tab */}
              <TabsContent value="clinical" className="space-y-4 mt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Client Stage & Progress</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="clientType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Type</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value || ""}
                            onValueChange={field.onChange}
                            options={clientTypeOptions.options?.map((option: any) => ({
                              value: option.optionKey || option.optionkey,
                              label: option.optionLabel || option.optionlabel
                            })) || []}
                            placeholder="Select client type"
                            searchPlaceholder="Search client types..."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="stage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Stage</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value || ""}
                            onValueChange={field.onChange}
                            options={clientStageOptions?.options?.map((option: any) => ({
                              value: option.optionKey || option.optionkey,
                              label: option.optionLabel || option.optionlabel
                            })) || []}
                            placeholder="Select stage"
                            searchPlaceholder="Search stage options..."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {user?.role !== "therapist" && (
                  <div className="grid grid-cols-2 gap-4">

                    <FormField
                      control={form.control}
                      name="assignedTherapistId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Assigned Therapist</FormLabel>
                          <FormControl>
                            <SearchableSelect
                              value={field.value?.toString() || "unassigned"}
                              onValueChange={(value) => field.onChange(value === "unassigned" ? undefined : parseInt(value))}
                              options={[
                                { value: "unassigned", label: "Unassigned" },
                                ...(therapists?.map((therapist: any) => ({
                                  value: therapist.id.toString(),
                                  label: therapist.fullName || therapist.full_name
                                })) || [])
                              ]}
                              placeholder="Select therapist"
                              searchPlaceholder="Search therapists..."
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Follow-up Management</h4>
                  
                  <div className="grid grid-cols-1 gap-4 mb-4">
                    <FormField
                      control={form.control}
                      name="needsFollowUp"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel>
                              Needs Follow-up
                            </FormLabel>
                            <p className="text-sm text-muted-foreground">
                              Mark this client for follow-up attention
                            </p>
                          </div>
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="followUpPriority"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Priority</FormLabel>
                          <FormControl>
                            <SearchableSelect
                              value={field.value || ""}
                              onValueChange={field.onChange}
                              options={[
                                { value: "", label: "None" },
                                { value: "low", label: "Low" },
                                { value: "medium", label: "Medium" },
                                { value: "high", label: "High" },
                                { value: "urgent", label: "Urgent" }
                              ]}
                              placeholder="Select priority"
                              searchPlaceholder="Search priority levels..."
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="followUpDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Due Date</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="followUpNotes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Follow-up Notes</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Brief follow-up notes..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
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
                          <FormControl>
                            <SearchableSelect
                              value={field.value || ""}
                              onValueChange={field.onChange}
                              options={[
                                { value: "psychotherapy", label: "Psychotherapy" },
                                { value: "counseling", label: "Counseling" },
                                { value: "assessment", label: "Assessment" },
                                { value: "consultation", label: "Consultation" },
                                { value: "group_therapy", label: "Group Therapy" },
                                { value: "family_therapy", label: "Family Therapy" },
                                { value: "couples_therapy", label: "Couples Therapy" }
                              ]}
                              placeholder="Treatment service details"
                              searchPlaceholder="Search service types..."
                            />
                          </FormControl>
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
                          <FormControl>
                            <SearchableSelect
                              value={field.value || ""}
                              onValueChange={field.onChange}
                              options={[
                                { value: "weekly", label: "Weekly" },
                                { value: "biweekly", label: "Bi-weekly" },
                                { value: "monthly", label: "Monthly" },
                                { value: "as_needed", label: "As Needed" },
                                { value: "intensive", label: "Intensive (Multiple per week)" }
                              ]}
                              placeholder="Frequency of treatment"
                              searchPlaceholder="Search frequency options..."
                            />
                          </FormControl>
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
                          <Input {...field} placeholder="e.g., Blue Cross, Aetna" />
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
                            <Input {...field} placeholder="Policy number" />
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
                            <Input {...field} placeholder="Group number" />
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
                            <Input {...field} placeholder="25.00" />
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
                            <Input {...field} placeholder="500.00" />
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
                            <Input {...field} placeholder="1-800-123-4567" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Additional Information</h4>
                  
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>General Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder="General notes about the client..." />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              {/* Contact & Address Information Tab */}
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
                          <Input {...field} placeholder="555-0123" />
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
                          <Input {...field} placeholder="555-0456" />
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
                        <Input {...field} type="email" placeholder="client@example.com" />
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
                          <Input {...field} placeholder="Primary address line" />
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
                        <FormLabel>Street Address 2</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Apartment, suite, etc. (optional)" />
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
                            <Input {...field} placeholder="City name" />
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
                            <Input {...field} placeholder="State or Province" />
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
                          <FormLabel>Postal Code</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="ZIP/Postal Code" />
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
                            <Input {...field} placeholder="Country name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Legacy Address Fields</h4>
                  
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address (Legacy)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Old address field (replaced by structured address)" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State (Legacy)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="State" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="zipCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ZIP Code (Legacy)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="ZIP" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Emergency Contact (Legacy)</h4>
                  
                  <FormField
                    control={form.control}
                    name="emergencyContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Emergency contact name" />
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
                          <FormLabel>Contact Phone</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="555-0123" />
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
                            <Input {...field} placeholder="e.g., Spouse, Parent" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Referral & Case Information Tab */}
              <TabsContent value="referral" className="space-y-4 mt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Referral & Case Information</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="referralDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Referral Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="referrerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Referrer Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Who referred this client" />
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
                        <Input {...field} placeholder="Case reference ID" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clientSource"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Referral Sources</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onValueChange={field.onChange}
                          options={referralSourceOptions.options.map((option: any) => ({
                            value: option.optionKey || option.optionkey,
                            label: option.optionLabel || option.optionlabel
                          }))}
                          placeholder="How client found the practice"
                          searchPlaceholder="Search referral sources..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="border-t pt-4 mt-6">
                  <h4 className="text-md font-medium text-slate-900 mb-4">Legacy Referral Fields</h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="referralSource"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Referral Source (Legacy)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="e.g., Self-referral, Physician" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="referralType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Referral Type (Legacy)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="e.g., Medical, EAP" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="referringPerson"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Referring Person (Legacy)</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Name of referring person" />
                        </FormControl>
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
                          <Textarea {...field} placeholder="Additional referral information..." />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              {/* Employment & Socioeconomic Tab */}
              <TabsContent value="employment" className="space-y-4 mt-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Employment & Socioeconomic</h3>
                
                <FormField
                  control={form.control}
                  name="employmentStatus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employment Status</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onValueChange={field.onChange}
                          options={employmentStatusOptions.options.map((option: any) => ({
                            value: option.optionKey || option.optionkey,
                            label: option.optionLabel || option.optionlabel
                          }))}
                          placeholder="Select employment status"
                          searchPlaceholder="Search employment status..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="educationLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Education Levels</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value || ""}
                          onValueChange={field.onChange}
                          options={educationLevelOptions.options.map((option: any) => ({
                            value: option.optionKey || option.optionkey,
                            label: option.optionLabel || option.optionlabel
                          }))}
                          placeholder="Highest education completed"
                          searchPlaceholder="Search education levels..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                disabled={createClientMutation.isPending}
                className="min-w-[120px]"
              >
                {createClientMutation.isPending ? (
                  <div className="flex items-center space-x-2">
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Creating...</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <i className="fas fa-plus"></i>
                    <span>Create Client</span>
                  </div>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
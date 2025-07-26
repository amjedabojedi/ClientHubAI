import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

interface AddClientModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const clientFormSchema = insertClientSchema.extend({
  assignedTherapistId: z.number().optional(),
});

type ClientFormData = z.infer<typeof clientFormSchema>;

export default function AddClientModal({ isOpen, onClose }: AddClientModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: therapists } = useQuery({
    queryKey: ["/api/therapists"],
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
      clientType: "individual",
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

  const createClientMutation = useMutation({
    mutationFn: (data: ClientFormData) => apiRequest("/api/clients", "POST", data),
    onSuccess: () => {
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
                        <FormLabel>Gender</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
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
                        <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
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
                      <FormLabel>Preferred Language</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                            <Input {...field} type="email" placeholder="portal@example.com" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
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
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="individual">Individual</SelectItem>
                            <SelectItem value="couple">Couple</SelectItem>
                            <SelectItem value="family">Family</SelectItem>
                            <SelectItem value="group">Group</SelectItem>
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
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                            {therapists?.map((therapist: any) => (
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
                          <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
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
                          <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
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
                      <FormLabel>Client Source</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="How client found the practice" />
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
                      <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select employment status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="full_time">Full-time Employed</SelectItem>
                          <SelectItem value="part_time">Part-time Employed</SelectItem>
                          <SelectItem value="self_employed">Self-employed</SelectItem>
                          <SelectItem value="unemployed">Unemployed</SelectItem>
                          <SelectItem value="retired">Retired</SelectItem>
                          <SelectItem value="student">Student</SelectItem>
                          <SelectItem value="homemaker">Homemaker</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
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
                      <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Highest education completed" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="less_than_high_school">Less than High School</SelectItem>
                          <SelectItem value="high_school">High School/GED</SelectItem>
                          <SelectItem value="some_college">Some College</SelectItem>
                          <SelectItem value="associates">Associate's Degree</SelectItem>
                          <SelectItem value="bachelors">Bachelor's Degree</SelectItem>
                          <SelectItem value="masters">Master's Degree</SelectItem>
                          <SelectItem value="doctoral">Doctoral Degree</SelectItem>
                          <SelectItem value="professional">Professional Degree</SelectItem>
                        </SelectContent>
                      </Select>
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
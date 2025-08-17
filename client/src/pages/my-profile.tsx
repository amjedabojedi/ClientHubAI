import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, User, Briefcase, GraduationCap, Award, Calendar, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Profile form schema
const profileFormSchema = z.object({
  // Basic Information
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
  
  // License Information
  licenseNumber: z.string().optional(),
  licenseType: z.string().optional(),
  licenseState: z.string().optional(),
  licenseExpiry: z.string().optional(),
  
  // Professional Information
  yearsOfExperience: z.number().min(0).default(0),
  maxClientsPerDay: z.number().min(0).default(0),
  sessionDuration: z.number().min(0).default(50),
  
  // Emergency Contact
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  
  // Clinical Background
  clinicalExperience: z.string().optional(),
  researchBackground: z.string().optional(),
  supervisoryExperience: z.string().optional(),
  careerObjectives: z.string().optional(),
  
  // Arrays for specializations and other multi-value fields
  specializations: z.array(z.string()).default([]),
  treatmentApproaches: z.array(z.string()).default([]),
  ageGroups: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  education: z.array(z.string()).default([]),
  workingDays: z.array(z.string()).default([]),
  previousPositions: z.array(z.string()).default([]),
  publications: z.array(z.string()).default([]),
  professionalMemberships: z.array(z.string()).default([]),
  continuingEducation: z.array(z.string()).default([]),
  awardRecognitions: z.array(z.string()).default([]),
  professionalReferences: z.array(z.string()).default([]),
});

type ProfileFormData = z.infer<typeof profileFormSchema>;

export default function MyProfilePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("basic");

  // Fetch current user information
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ["/api/users/me"],
  });

  // Fetch current user profile
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["/api/users/me/profile"],
  });

  // Form setup
  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      licenseNumber: "",
      licenseType: "",
      licenseState: "",
      licenseExpiry: "",
      yearsOfExperience: 0,
      maxClientsPerDay: 0,
      sessionDuration: 50,
      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelationship: "",
      clinicalExperience: "",
      researchBackground: "",
      supervisoryExperience: "",
      careerObjectives: "",
      specializations: [],
      treatmentApproaches: [],
      ageGroups: [],
      languages: [],
      certifications: [],
      education: [],
      workingDays: [],
      previousPositions: [],
      publications: [],
      professionalMemberships: [],
      continuingEducation: [],
      awardRecognitions: [],
      professionalReferences: [],
    },
  });

  // Update form when data loads (only once when data actually changes)
  React.useEffect(() => {
    if (user && user.fullName && !userLoading && !profileLoading) {
      const formData = {
        fullName: user.fullName || "",
        email: user.email || "",
        licenseNumber: profile?.licenseNumber || "",
        licenseType: profile?.licenseType || "",
        licenseState: profile?.licenseState || "",
        licenseExpiry: profile?.licenseExpiry || "",
        yearsOfExperience: profile?.yearsOfExperience || 0,
        maxClientsPerDay: profile?.maxClientsPerDay || 0,
        sessionDuration: profile?.sessionDuration || 50,
        emergencyContactName: profile?.emergencyContactName || "",
        emergencyContactPhone: profile?.emergencyContactPhone || "",
        emergencyContactRelationship: profile?.emergencyContactRelationship || "",
        clinicalExperience: profile?.clinicalExperience || "",
        researchBackground: profile?.researchBackground || "",
        supervisoryExperience: profile?.supervisoryExperience || "",
        careerObjectives: profile?.careerObjectives || "",
        specializations: profile?.specializations || [],
        treatmentApproaches: profile?.treatmentApproaches || [],
        ageGroups: profile?.ageGroups || [],
        languages: profile?.languages || [],
        certifications: profile?.certifications || [],
        education: profile?.education || [],
        workingDays: profile?.workingDays || [],
        previousPositions: profile?.previousPositions || [],
        publications: profile?.publications || [],
        professionalMemberships: profile?.professionalMemberships || [],
        continuingEducation: profile?.continuingEducation || [],
        awardRecognitions: profile?.awardRecognitions || [],
        professionalReferences: profile?.professionalReferences || [],
      };
      form.reset(formData);
    }
  }, [user?.fullName, profile?.id]);

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async (data: { fullName: string; email: string }) => {
      return await apiRequest("/api/users/me", "PUT", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
    },
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: Omit<ProfileFormData, 'fullName' | 'email'>) => {
      return await apiRequest("/api/users/me/profile", "PUT", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/me/profile"] });
    },
  });

  // Create profile mutation (if profile doesn't exist)
  const createProfileMutation = useMutation({
    mutationFn: async (data: Omit<ProfileFormData, 'fullName' | 'email'>) => {
      return await apiRequest("/api/users/me/profile", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/me/profile"] });
    },
  });

  const onSubmit = async (data: ProfileFormData) => {
    try {
      // Update user basic info
      await updateUserMutation.mutateAsync({
        fullName: data.fullName,
        email: data.email,
      });

      // Prepare profile data (exclude user fields)
      const { fullName, email, ...profileData } = data;

      // Update or create profile
      if (profile) {
        await updateProfileMutation.mutateAsync(profileData);
      } else {
        await createProfileMutation.mutateAsync(profileData);
      }

      toast({
        title: "Success",
        description: "Your profile has been updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    }
  };

  if (userLoading || profileLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-300">Loading your profile...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">My Profile</h1>
          <p className="text-gray-600 dark:text-gray-300">
            Manage your professional information and credentials
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-6">
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
                <TabsTrigger value="license">License</TabsTrigger>
                <TabsTrigger value="specializations">Specializations</TabsTrigger>
                <TabsTrigger value="background">Background</TabsTrigger>
                <TabsTrigger value="schedule">Schedule</TabsTrigger>
                <TabsTrigger value="contact">Contact</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <User className="w-5 h-5" />
                      Basic Information
                    </CardTitle>
                    <CardDescription>
                      Your personal and professional details
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="fullName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Full Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Dr. John Smith" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email Address</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="john@example.com" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="yearsOfExperience"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Years of Experience</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="maxClientsPerDay"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Max Clients Per Day</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="sessionDuration"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Session Duration (minutes)</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                {...field} 
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="license" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Award className="w-5 h-5" />
                      License Information
                    </CardTitle>
                    <CardDescription>
                      Your professional licensing details
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="licenseNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>License Number</FormLabel>
                            <FormControl>
                              <Input placeholder="123456" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="licenseType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>License Type</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select license type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="LCSW">LCSW - Licensed Clinical Social Worker</SelectItem>
                                <SelectItem value="LMFT">LMFT - Licensed Marriage and Family Therapist</SelectItem>
                                <SelectItem value="LPCC">LPCC - Licensed Professional Clinical Counselor</SelectItem>
                                <SelectItem value="LMHC">LMHC - Licensed Mental Health Counselor</SelectItem>
                                <SelectItem value="PhD">PhD - Doctor of Philosophy</SelectItem>
                                <SelectItem value="PsyD">PsyD - Doctor of Psychology</SelectItem>
                                <SelectItem value="MD">MD - Medical Doctor</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="licenseState"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>License State</FormLabel>
                            <FormControl>
                              <Input placeholder="CA" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="licenseExpiry"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>License Expiry Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="specializations" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Briefcase className="w-5 h-5" />
                      Professional Specializations
                    </CardTitle>
                    <CardDescription>
                      Your areas of expertise and specialization
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="clinicalExperience"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Clinical Experience Summary</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Describe your clinical experience and expertise..." 
                              rows={4}
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="researchBackground"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Research Background</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Describe your research experience and publications..." 
                              rows={3}
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="supervisoryExperience"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Supervisory Experience</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Describe your experience supervising other professionals..." 
                              rows={3}
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="background" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <GraduationCap className="w-5 h-5" />
                      Professional Background
                    </CardTitle>
                    <CardDescription>
                      Your educational and career background
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="careerObjectives"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Career Objectives</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Describe your professional goals and objectives..." 
                              rows={3}
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="schedule" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="w-5 h-5" />
                      Schedule Preferences
                    </CardTitle>
                    <CardDescription>
                      Your availability and scheduling preferences
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Schedule management features will be available in future updates.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="contact" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Phone className="w-5 h-5" />
                      Emergency Contact
                    </CardTitle>
                    <CardDescription>
                      Emergency contact information
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="emergencyContactName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Emergency Contact Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Jane Smith" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="emergencyContactPhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Emergency Contact Phone</FormLabel>
                            <FormControl>
                              <Input placeholder="(555) 123-4567" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="emergencyContactRelationship"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Relationship</FormLabel>
                          <FormControl>
                            <Input placeholder="Spouse, Sibling, Parent, etc." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="flex justify-end space-x-4">
              <Button 
                type="submit" 
                disabled={updateUserMutation.isPending || updateProfileMutation.isPending || createProfileMutation.isPending}
                className="flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {updateUserMutation.isPending || updateProfileMutation.isPending || createProfileMutation.isPending 
                  ? "Saving..." 
                  : "Save Profile"
                }
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
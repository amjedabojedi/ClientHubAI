import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Save,
  User,
  Briefcase,
  GraduationCap,
  Award,
  Calendar,
  Phone,
  Lock,
  Video,
  Check,
  X,
  AlertCircle,
  HelpCircle,
  ChevronDown,
} from "lucide-react";
import { WorkingHoursEditor } from "@/components/user-profiles/WorkingHoursEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SearchableSelect,
  SearchableSelectOption,
} from "@/components/ui/searchable-select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

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
  workingHours: z.string().optional(), // JSON string of working hours per day

  // Room Configuration
  virtualRoomId: z.number().optional(), // Virtual room ID for online sessions
  availablePhysicalRooms: z.array(z.number()).default([]), // Physical room IDs this therapist can use

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

// Password change form schema
const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(6, "New password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type PasswordChangeData = z.infer<typeof passwordChangeSchema>;

// Zoom credentials form schema
const zoomCredentialsSchema = z.object({
  zoomAccountId: z.string().min(1, "Account ID is required"),
  zoomClientId: z.string().min(1, "Client ID is required"),
  zoomClientSecret: z.string().min(1, "Client Secret is required"),
});

type ZoomCredentialsData = z.infer<typeof zoomCredentialsSchema>;

type ZoomStatusResponse = {
  isConfigured: boolean;
  zoomAccountId?: string | null;
  zoomClientId?: string | null;
};

// Virtual room select component (only online rooms)
function VirtualRoomSelect({
  value,
  onChange,
}: {
  value?: number;
  onChange: (value: number | undefined) => void;
}) {
  const { data: rooms = [] } = useQuery<
    Array<{
      id: number;
      roomNumber: string;
      roomName: string;
      isActive: boolean;
    }>
  >({
    queryKey: ["/api/rooms"],
  });

  const onlineRooms = rooms.filter(
    (room) => room.isActive && room.roomName.toLowerCase().includes("online"),
  );

  return (
    <Select
      value={value?.toString() || "0"}
      onValueChange={(val) => onChange(val === "0" ? undefined : parseInt(val))}
    >
      <SelectTrigger data-testid="select-virtual-room">
        <SelectValue placeholder="Select your online room" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="0">None</SelectItem>
        {onlineRooms.map((room) => (
          <SelectItem key={room.id} value={room.id.toString()}>
            {room.roomNumber} - {room.roomName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Multi-select physical rooms component (only physical rooms)
function PhysicalRoomsMultiSelect({
  value,
  onChange,
}: {
  value?: number[] | null;
  onChange: (value: number[]) => void;
}) {
  // Ensure value is always an array of numbers (handles undefined, null, strings, or invalid values)
  const safeValue = Array.isArray(value) ? value.map(v => Number(v)) : [];

  const { data: rooms = [] } = useQuery<
    Array<{
      id: number;
      roomNumber: string;
      roomName: string;
      isActive: boolean;
    }>
  >({
    queryKey: ["/api/rooms"],
  });

  const physicalRooms = rooms.filter(
    (room) => room.isActive && !room.roomName.toLowerCase().includes("online"),
  );

  const toggleRoom = (roomId: number) => {
    const numericRoomId = Number(roomId);
    if (safeValue.includes(numericRoomId)) {
      onChange(safeValue.filter((id) => id !== numericRoomId));
    } else {
      onChange([...safeValue, numericRoomId]);
    }
  };

  return (
    <div className="space-y-2">
      {physicalRooms.map((room) => {
        const numericRoomId = Number(room.id);
        return (
          <div key={room.id} className="flex items-center space-x-2">
            <input
              type="checkbox"
              id={`room-${room.id}`}
              checked={safeValue.includes(numericRoomId)}
              onChange={() => toggleRoom(numericRoomId)}
              className="h-4 w-4 rounded border-gray-300"
              data-testid={`checkbox-room-${room.id}`}
            />
            <label htmlFor={`room-${room.id}`} className="text-sm cursor-pointer">
              {room.roomNumber} - {room.roomName}
            </label>
          </div>
        );
      })}
      {physicalRooms.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No physical rooms available
        </p>
      )}
    </div>
  );
}

export default function MyProfilePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("basic");
  const [isHelpOpen, setIsHelpOpen] = useState(true);

  // Get current logged-in user
  const { user: authUser } = useAuth();
  const userId = authUser?.id;

  // Fetch current user information
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ["/api/users/me", { userId }],
    enabled: !!userId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (userId) params.append("userId", userId.toString());
      const response = await fetch(`/api/users/me?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch user");
      return response.json();
    },
  });

  // Fetch current user profile
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["/api/users/me/profile", { userId }],
    enabled: !!userId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (userId) params.append("userId", userId.toString());
      const response = await fetch(
        `/api/users/me/profile?${params.toString()}`,
      );
      if (!response.ok) throw new Error("Failed to fetch profile");
      return response.json();
    },
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
      workingHours: "",
      virtualRoomId: undefined,
      availablePhysicalRooms: [],
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
console.log("form availablePhysicalRooms", form.watch('availablePhysicalRooms'))
  console.log("form virtualRoomId", form.watch('virtualRoomId'))
  // Password change form setup
  const passwordForm = useForm<PasswordChangeData>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Zoom credentials form setup
  const zoomForm = useForm<ZoomCredentialsData>({
    resolver: zodResolver(zoomCredentialsSchema),
    defaultValues: {
      zoomAccountId: "",
      zoomClientId: "",
      zoomClientSecret: "",
    },
  });

  // Fetch Zoom credentials status
  const { data: zoomStatus, refetch: refetchZoomStatus } =
    useQuery<ZoomStatusResponse>({
      queryKey: ["/api/users/me/zoom-credentials/status"],
      enabled: !!userId,
    });

  // Update form when data loads (only once when data actually changes)
  React.useEffect(() => {
    if (user && !userLoading && !profileLoading) {
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
        workingHours: profile?.workingHours || "",
        virtualRoomId: profile?.virtualRoomId || undefined,
        availablePhysicalRooms: profile?.availablePhysicalRooms || [],
        emergencyContactName: profile?.emergencyContactName || "",
        emergencyContactPhone: profile?.emergencyContactPhone || "",
        emergencyContactRelationship:
          profile?.emergencyContactRelationship || "",
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
  }, [user?.id, user?.email, user?.fullName, profile?.id]);

  // Update Zoom form when credentials are loaded
  React.useEffect(() => {
    if (zoomStatus) {
      if (zoomStatus.isConfigured) {
        // Populate form with existing credentials
        zoomForm.reset({
          zoomAccountId: zoomStatus.zoomAccountId || "",
          zoomClientId: zoomStatus.zoomClientId || "",
          zoomClientSecret: "", // Don't populate secret for security
        });
      } else {
        // Clear form when no credentials
        zoomForm.reset({
          zoomAccountId: "",
          zoomClientId: "",
          zoomClientSecret: "",
        });
      }
    }
  }, [
    zoomStatus?.isConfigured,
    zoomStatus?.zoomAccountId,
    zoomStatus?.zoomClientId,
  ]);

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async (data: { fullName: string; email: string }) => {
      return await apiRequest("/api/users/me", "PUT", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/users/me", { userId }],
      });
    },
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: Omit<ProfileFormData, "fullName" | "email">) => {
      return await apiRequest("/api/users/me/profile", "PUT", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/users/me/profile", { userId }],
      });
    },
  });

  // Create profile mutation (if profile doesn't exist)
  const createProfileMutation = useMutation({
    mutationFn: async (data: Omit<ProfileFormData, "fullName" | "email">) => {
      return await apiRequest("/api/users/me/profile", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/me/profile"] });
    },
  });

  // Password change mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (data: PasswordChangeData) => {
      return await apiRequest("/api/users/me/change-password", "POST", data);
    },
    onSuccess: () => {
      passwordForm.reset();
      toast({
        title: "Success",
        description: "Your password has been changed successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to change password",
        variant: "destructive",
      });
    },
  });

  // Zoom credentials mutations
  const saveZoomCredentialsMutation = useMutation({
    mutationFn: async (data: ZoomCredentialsData) => {
      return await apiRequest("/api/users/me/zoom-credentials", "PUT", data);
    },
    onSuccess: () => {
      refetchZoomStatus();
      zoomForm.reset();
      toast({
        title: "Success",
        description: "Zoom credentials saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save Zoom credentials",
        variant: "destructive",
      });
    },
  });

  const removeZoomCredentialsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("/api/users/me/zoom-credentials", "DELETE");
    },
    onSuccess: () => {
      refetchZoomStatus();
      zoomForm.reset();
      toast({
        title: "Success",
        description: "Zoom credentials removed successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove Zoom credentials",
        variant: "destructive",
      });
    },
  });

  const testZoomConnectionMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(
        "/api/users/me/zoom-credentials/test",
        "POST",
        {},
      );
    },
    onSuccess: (data: any) => {
      toast({
        title: "Connection Successful",
        description: data.message || "Zoom credentials verified successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to verify Zoom credentials",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: ProfileFormData) => {
    try {
      console.log("form availablePhysicalRooms", form.watch('availablePhysicalRooms'))
      console.log("form virtualRoomId", form.watch('virtualRoomId'))
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

  const onPasswordSubmit = async (data: PasswordChangeData) => {
    await changePasswordMutation.mutateAsync(data);
  };

  const onZoomSubmit = async (data: ZoomCredentialsData) => {
    await saveZoomCredentialsMutation.mutateAsync(data);
  };

  const handleRemoveZoomCredentials = async () => {
    if (confirm("Are you sure you want to remove your Zoom credentials?")) {
      await removeZoomCredentialsMutation.mutateAsync();
    }
  };

  const handleTestZoomConnection = async () => {
    await testZoomConnectionMutation.mutateAsync();
  };

  if (userLoading || profileLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-300">
              Loading your profile...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">My Profile</h1>
          <p className="text-slate-600 mt-1">
            Manage your professional information and credentials
          </p>
        </div>

        {/* Help Section */}
        <Collapsible
          open={isHelpOpen}
          onOpenChange={setIsHelpOpen}
          className="mb-6"
        >
          <Card className="border-blue-200 bg-blue-50">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-blue-100 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-blue-600" />
                    <CardTitle className="text-base">
                      Professional Profile Guide
                    </CardTitle>
                  </div>
                  <ChevronDown
                    className={`w-5 h-5 text-blue-600 transition-transform ${isHelpOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    1
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      Basic Information & License
                    </p>
                    <p className="text-xs text-gray-600">
                      Enter your full name, email, and professional credentials.
                      Your full name and license information appear on all
                      client invoices, session documentation, and assessment
                      reports. Ensure all details are accurate and current as
                      they represent your practice officially.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    2
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      Specializations & Treatment Approaches
                    </p>
                    <p className="text-xs text-gray-600">
                      List your clinical specializations, treatment modalities,
                      age groups served, and languages spoken. This information
                      helps with client matching and appears in assessment
                      reports. Add certifications and education details to
                      demonstrate expertise on professional documentation.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    3
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      Clinical Background & Experience
                    </p>
                    <p className="text-xs text-gray-600">
                      Document your years of experience, clinical background,
                      research involvement, supervisory experience, and career
                      objectives. Include previous positions, publications,
                      professional memberships, continuing education, and
                      awards. This comprehensive background appears on official
                      reports and documentation.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    4
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      Schedule & Room Configuration
                    </p>
                    <p className="text-xs text-gray-600">
                      Set your working days/hours, session duration (default 50
                      min), max clients per day, and room availability.
                      Configure your virtual room for online sessions and select
                      available physical rooms. These settings control
                      appointment availability and prevent double-booking
                      conflicts in the scheduling system.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    5
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      Emergency Contact & Zoom Integration
                    </p>
                    <p className="text-xs text-gray-600">
                      Add emergency contact information for practice safety
                      protocols. Configure Zoom credentials (Account ID, Client
                      ID, Client Secret) to enable automatic virtual meeting
                      links for online sessions. Test your Zoom connection to
                      verify integration before scheduling online appointments.
                    </p>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                  <p className="text-xs text-blue-900">
                    <strong>💡 Pro Tips:</strong> Your full name, license
                    details, and credentials appear on client invoices, session
                    notes, assessment reports, and all official documentation.
                    Keep this information current and professional. Changes to
                    working hours affect scheduling availability immediately.
                    Save each tab individually after making edits.
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-8">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="license">License</TabsTrigger>
            <TabsTrigger value="specializations">Specializations</TabsTrigger>
            <TabsTrigger value="background">Background</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="zoom">Zoom</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>

          {/* Profile Form - All tabs except password and zoom */}
          {activeTab !== "password" && activeTab !== "zoom" && (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
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
                                <Input
                                  placeholder="Dr. John Smith"
                                  {...field}
                                />
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
                                <Input
                                  type="email"
                                  placeholder="john@example.com"
                                  {...field}
                                />
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
                                  onChange={(e) =>
                                    field.onChange(
                                      parseInt(e.target.value) || 0,
                                    )
                                  }
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
                                  onChange={(e) =>
                                    field.onChange(
                                      parseInt(e.target.value) || 0,
                                    )
                                  }
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
                                  onChange={(e) =>
                                    field.onChange(
                                      parseInt(e.target.value) || 0,
                                    )
                                  }
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
                              <Select
                                onValueChange={field.onChange}
                                value={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select license type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="LCSW">
                                    LCSW - Licensed Clinical Social Worker
                                  </SelectItem>
                                  <SelectItem value="LMFT">
                                    LMFT - Licensed Marriage and Family
                                    Therapist
                                  </SelectItem>
                                  <SelectItem value="LPCC">
                                    LPCC - Licensed Professional Clinical
                                    Counselor
                                  </SelectItem>
                                  <SelectItem value="LMHC">
                                    LMHC - Licensed Mental Health Counselor
                                  </SelectItem>
                                  <SelectItem value="PhD">
                                    PhD - Doctor of Philosophy
                                  </SelectItem>
                                  <SelectItem value="PsyD">
                                    PsyD - Doctor of Psychology
                                  </SelectItem>
                                  <SelectItem value="MD">
                                    MD - Medical Doctor
                                  </SelectItem>
                                  <SelectItem value="CRPO">
                                    CRPO - College of Registered
                                    Psychotherapists of Ontario
                                  </SelectItem>
                                  <SelectItem value="OCSWSSW">
                                    The Ontario College of Social Workers and
                                    Social Service Workers
                                  </SelectItem>
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
                  <FormField
                    control={form.control}
                    name="workingHours"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <WorkingHoursEditor
                            value={field.value}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Video className="w-5 h-5" />
                        Room Configuration
                      </CardTitle>
                      <CardDescription>
                        Configure which rooms you use for appointments
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <FormField
                        control={form.control}
                        name="virtualRoomId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Your Online Room</FormLabel>
                            <p className="text-sm text-muted-foreground mb-2">
                              Select your dedicated virtual room for online
                              sessions
                            </p>
                            <FormControl>
                              <VirtualRoomSelect
                                value={field.value}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="availablePhysicalRooms"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Available Physical Rooms</FormLabel>
                            <p className="text-sm text-muted-foreground mb-2">
                              Select all physical rooms you can use for
                              appointments
                            </p>
                            <FormControl>
                              <PhysicalRoomsMultiSelect
                                value={field.value}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
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
                                <Input
                                  placeholder="(555) 123-4567"
                                  {...field}
                                />
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
                              <Input
                                placeholder="Spouse, Sibling, Parent, etc."
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

                <div className="flex justify-end space-x-4">
                  <Button
                    type="submit"
                    disabled={
                      updateUserMutation.isPending ||
                      updateProfileMutation.isPending ||
                      createProfileMutation.isPending
                    }
                    className="flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {updateUserMutation.isPending ||
                    updateProfileMutation.isPending ||
                    createProfileMutation.isPending
                      ? "Saving..."
                      : "Save Profile"}
                  </Button>
                </div>
              </form>
            </Form>
          )}

          {/* Zoom Integration Tab - Separate form */}
          {activeTab === "zoom" && (
            <TabsContent value="zoom" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Video className="w-5 h-5" />
                    Zoom Integration
                  </CardTitle>
                  <CardDescription>
                    Configure your personal Zoom account for video sessions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Status Badge */}
                  <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {zoomStatus?.isConfigured ? (
                          <>
                            <Check className="w-5 h-5 text-green-600" />
                            <span className="text-sm font-medium text-green-600">
                              Zoom Configured
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-5 h-5 text-orange-500" />
                            <span className="text-sm font-medium text-orange-500">
                              Not Configured
                            </span>
                          </>
                        )}
                      </div>
                      {zoomStatus?.isConfigured && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleTestZoomConnection}
                            disabled={testZoomConnectionMutation.isPending}
                            data-testid="button-test-zoom"
                          >
                            {testZoomConnectionMutation.isPending
                              ? "Testing..."
                              : "Test Connection"}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={handleRemoveZoomCredentials}
                            disabled={removeZoomCredentialsMutation.isPending}
                            data-testid="button-remove-zoom"
                          >
                            <X className="w-4 h-4 mr-1" />
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Instructions */}
                  <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                    <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                      How to get your Zoom credentials:
                    </h4>
                    <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800 dark:text-blue-200">
                      <li>
                        Go to{" "}
                        <a
                          href="https://marketplace.zoom.us/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          Zoom Marketplace
                        </a>
                      </li>
                      <li>Click "Develop" → "Build App"</li>
                      <li>Choose "Server-to-Server OAuth" app type</li>
                      <li>Fill in app information and create the app</li>
                      <li>
                        Copy the Account ID, Client ID, and Client Secret from
                        the app credentials page
                      </li>
                      <li>Paste them below and save</li>
                    </ol>
                  </div>

                  <Form {...zoomForm}>
                    <form
                      onSubmit={zoomForm.handleSubmit(onZoomSubmit)}
                      className="space-y-6"
                    >
                      <FormField
                        control={zoomForm.control}
                        name="zoomAccountId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Zoom Account ID</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Enter your Zoom Account ID"
                                {...field}
                                data-testid="input-zoom-account-id"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={zoomForm.control}
                        name="zoomClientId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Zoom Client ID</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Enter your Zoom Client ID"
                                {...field}
                                data-testid="input-zoom-client-id"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={zoomForm.control}
                        name="zoomClientSecret"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Zoom Client Secret</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="Enter your Zoom Client Secret"
                                {...field}
                                data-testid="input-zoom-client-secret"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          disabled={saveZoomCredentialsMutation.isPending}
                          className="flex items-center gap-2"
                          data-testid="button-save-zoom"
                        >
                          <Save className="w-4 h-4" />
                          {saveZoomCredentialsMutation.isPending
                            ? "Saving..."
                            : "Save Credentials"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Password Tab - Separate form */}
          {activeTab === "password" && (
            <TabsContent value="password" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lock className="w-5 h-5" />
                    Change Password
                  </CardTitle>
                  <CardDescription>
                    Update your account password for security
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...passwordForm}>
                    <form
                      onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
                      className="space-y-6"
                    >
                      <FormField
                        control={passwordForm.control}
                        name="currentPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Current Password</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="Enter your current password"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={passwordForm.control}
                        name="newPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>New Password</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="Enter your new password"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={passwordForm.control}
                        name="confirmPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Confirm New Password</FormLabel>
                            <FormControl>
                              <Input
                                type="password"
                                placeholder="Confirm your new password"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          disabled={changePasswordMutation.isPending}
                          className="flex items-center gap-2"
                        >
                          <Lock className="w-4 h-4" />
                          {changePasswordMutation.isPending
                            ? "Changing..."
                            : "Change Password"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

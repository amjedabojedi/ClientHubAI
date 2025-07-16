import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

// Icons
import { 
  Users, 
  User, 
  Plus,
  Edit3,
  Trash2,
  CheckCircle,
  XCircle,
  Shield,
  Award,
  Calendar,
  Clock,
  Mail,
  Phone,
  Briefcase,
  GraduationCap,
  Languages,
  UserCheck,
  AlertCircle,
  Settings
} from "lucide-react";

// Form Handling
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// Types
import type { User as UserType, UserProfile, SupervisorAssignment, InsertUser, InsertUserProfile, InsertSupervisorAssignment } from "@shared/schema";

// Utils
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

// Form Schemas
const createUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Invalid email address"),
  role: z.enum(["therapist", "supervisor", "admin"], {
    required_error: "Role is required",
  }),
  title: z.string().optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  bio: z.string().optional(),
});

const createProfileSchema = z.object({
  licenseNumber: z.string().optional(),
  licenseType: z.string().optional(),
  licenseState: z.string().optional(),
  licenseExpiry: z.string().optional(),
  specializations: z.array(z.string()).optional(),
  treatmentApproaches: z.array(z.string()).optional(),
  ageGroups: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  education: z.array(z.string()).optional(),
  yearsOfExperience: z.number().optional(),
  workingDays: z.array(z.string()).optional(),
  maxClientsPerDay: z.number().optional(),
  sessionDuration: z.number().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
});

type CreateUserFormData = z.infer<typeof createUserSchema>;
type CreateProfileFormData = z.infer<typeof createProfileSchema>;

interface UserWithProfile extends UserType {
  profile?: UserProfile;
}

export default function UserProfilesPage() {
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<UserWithProfile | null>(null);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserType | null>(null);

  // Fetch Users
  const { data: users = [], isLoading: isLoadingUsers } = useQuery<UserWithProfile[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const users = await apiRequest("/api/users");
      
      // Fetch profiles for each user
      const usersWithProfiles = await Promise.all(
        users.map(async (user: UserType) => {
          try {
            const profile = await apiRequest(`/api/users/${user.id}/profile`);
            return { ...user, profile };
          } catch (error) {
            return { ...user, profile: null };
          }
        })
      );
      
      return usersWithProfiles;
    },
  });

  // Create User Form
  const createUserForm = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      role: "therapist",
    },
  });

  // Create Profile Form
  const createProfileForm = useForm<CreateProfileFormData>({
    resolver: zodResolver(createProfileSchema),
    defaultValues: {
      specializations: [],
      treatmentApproaches: [],
      ageGroups: [],
      languages: [],
      certifications: [],
      education: [],
      workingDays: [],
      sessionDuration: 50,
    },
  });

  // Create User Mutation
  const createUserMutation = useMutation({
    mutationFn: async (data: CreateUserFormData) => {
      return await apiRequest("/api/users", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsCreateUserOpen(false);
      createUserForm.reset();
    },
  });

  // Create Profile Mutation
  const createProfileMutation = useMutation({
    mutationFn: async (data: { userId: number; profile: CreateProfileFormData }) => {
      return await apiRequest(`/api/users/${data.userId}/profile`, "POST", data.profile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsProfileModalOpen(false);
      createProfileForm.reset();
    },
  });

  // Update Profile Mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: { userId: number; profile: Partial<CreateProfileFormData> }) => {
      return await apiRequest(`/api/users/${data.userId}/profile`, "PUT", data.profile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsProfileModalOpen(false);
      createProfileForm.reset();
    },
  });

  // Delete User Mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      return await apiRequest(`/api/users/${userId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setUserToDelete(null);
    },
  });

  const handleCreateUser = (data: CreateUserFormData) => {
    createUserMutation.mutate(data);
  };

  const handleCreateProfile = (data: CreateProfileFormData) => {
    if (selectedUser) {
      if (selectedUser.profile) {
        updateProfileMutation.mutate({ userId: selectedUser.id, profile: data });
      } else {
        createProfileMutation.mutate({ userId: selectedUser.id, profile: data });
      }
    }
  };

  const handleEditProfile = (user: UserWithProfile) => {
    setSelectedUser(user);
    
    // Pre-populate form with existing profile data
    if (user.profile) {
      createProfileForm.reset({
        licenseNumber: user.profile.licenseNumber || "",
        licenseType: user.profile.licenseType || "",
        licenseState: user.profile.licenseState || "",
        licenseExpiry: user.profile.licenseExpiry || "",
        specializations: user.profile.specializations || [],
        treatmentApproaches: user.profile.treatmentApproaches || [],
        ageGroups: user.profile.ageGroups || [],
        languages: user.profile.languages || [],
        certifications: user.profile.certifications || [],
        education: user.profile.education || [],
        yearsOfExperience: user.profile.yearsOfExperience || 0,
        workingDays: user.profile.workingDays || [],
        maxClientsPerDay: user.profile.maxClientsPerDay || 0,
        sessionDuration: user.profile.sessionDuration || 50,
        emergencyContactName: user.profile.emergencyContactName || "",
        emergencyContactPhone: user.profile.emergencyContactPhone || "",
        emergencyContactRelationship: user.profile.emergencyContactRelationship || "",
      });
    }
    
    setIsProfileModalOpen(true);
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "supervisor":
        return <Shield className="w-4 h-4" />;
      case "admin":
        return <Settings className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "supervisor":
        return "bg-blue-100 text-blue-800";
      case "admin":
        return "bg-red-100 text-red-800";
      default:
        return "bg-green-100 text-green-800";
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "inactive":
        return "bg-gray-100 text-gray-800";
      case "suspended":
        return "bg-red-100 text-red-800";
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  };

  if (isLoadingUsers) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">Loading users...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">User Profiles</h1>
          <p className="text-gray-600 mt-2">Manage therapist and supervisor profiles</p>
        </div>
        
        <Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>
                Add a new therapist, supervisor, or administrator to the system.
              </DialogDescription>
            </DialogHeader>
            
            <Form {...createUserForm}>
              <form onSubmit={createUserForm.handleSubmit(handleCreateUser)} className="space-y-4">
                <FormField
                  control={createUserForm.control}
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
                  control={createUserForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="john.smith" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={createUserForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input placeholder="john.smith@clinic.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={createUserForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={createUserForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="therapist">Therapist</SelectItem>
                          <SelectItem value="supervisor">Supervisor</SelectItem>
                          <SelectItem value="admin">Administrator</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="flex gap-2 pt-4">
                  <Button type="submit" disabled={createUserMutation.isPending}>
                    {createUserMutation.isPending ? "Creating..." : "Create User"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsCreateUserOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {users.map((user) => (
          <Card key={user.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getRoleIcon(user.role)}
                  <CardTitle className="text-lg">{user.fullName}</CardTitle>
                </div>
                <Badge className={cn("text-xs", getRoleBadgeColor(user.role))}>
                  {user.role}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Badge className={cn("text-xs", getStatusBadgeColor(user.status))}>
                  {user.status}
                </Badge>
                <span>@{user.username}</span>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-gray-500" />
                <span className="truncate">{user.email}</span>
              </div>
              
              {user.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-gray-500" />
                  <span>{user.phone}</span>
                </div>
              )}
              
              {user.profile && (
                <div className="space-y-2">
                  {user.profile.licenseNumber && (
                    <div className="flex items-center gap-2 text-sm">
                      <Award className="w-4 h-4 text-gray-500" />
                      <span>{user.profile.licenseType} - {user.profile.licenseNumber}</span>
                    </div>
                  )}
                  
                  {user.profile.specializations && user.profile.specializations.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {user.profile.specializations.slice(0, 3).map((spec, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {spec}
                        </Badge>
                      ))}
                      {user.profile.specializations.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{user.profile.specializations.length - 3} more
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEditProfile(user)}
                  className="flex-1"
                >
                  <Edit3 className="w-4 h-4 mr-2" />
                  {user.profile ? "Edit Profile" : "Create Profile"}
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUserToDelete(user)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Profile Modal */}
      <Dialog open={isProfileModalOpen} onOpenChange={setIsProfileModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedUser?.profile ? "Edit Profile" : "Create Profile"} - {selectedUser?.fullName}
            </DialogTitle>
            <DialogDescription>
              {selectedUser?.profile 
                ? "Update professional profile information" 
                : "Add professional credentials and specializations"}
            </DialogDescription>
          </DialogHeader>
          
          <Form {...createProfileForm}>
            <form onSubmit={createProfileForm.handleSubmit(handleCreateProfile)} className="space-y-6">
              <Tabs defaultValue="license" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="license">License</TabsTrigger>
                  <TabsTrigger value="specializations">Specializations</TabsTrigger>
                  <TabsTrigger value="schedule">Schedule</TabsTrigger>
                  <TabsTrigger value="contact">Contact</TabsTrigger>
                </TabsList>
                
                <TabsContent value="license" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createProfileForm.control}
                      name="licenseNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>License Number</FormLabel>
                          <FormControl>
                            <Input placeholder="12345" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={createProfileForm.control}
                      name="licenseType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>License Type</FormLabel>
                          <FormControl>
                            <Input placeholder="LMFT, LCSW, etc." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createProfileForm.control}
                      name="licenseState"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>License State</FormLabel>
                          <FormControl>
                            <Input placeholder="California" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={createProfileForm.control}
                      name="licenseExpiry"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>License Expiry</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <FormField
                    control={createProfileForm.control}
                    name="yearsOfExperience"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Years of Experience</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="5" 
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>
                
                <TabsContent value="specializations" className="space-y-4">
                  <div className="text-sm text-gray-600 mb-4">
                    Add specializations, treatment approaches, and target populations (comma-separated)
                  </div>
                  
                  <FormField
                    control={createProfileForm.control}
                    name="specializations"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Specializations</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Anxiety, Depression, Trauma, ADHD"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.split(',').map(s => s.trim()).filter(s => s.length > 0))}
                            value={field.value?.join(', ') || ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={createProfileForm.control}
                    name="treatmentApproaches"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Treatment Approaches</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="CBT, DBT, Solution-Focused, Psychodynamic"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.split(',').map(s => s.trim()).filter(s => s.length > 0))}
                            value={field.value?.join(', ') || ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={createProfileForm.control}
                    name="ageGroups"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Age Groups</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Children, Adolescents, Adults, Seniors"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.split(',').map(s => s.trim()).filter(s => s.length > 0))}
                            value={field.value?.join(', ') || ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>
                
                <TabsContent value="schedule" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createProfileForm.control}
                      name="maxClientsPerDay"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Max Clients Per Day</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              placeholder="8" 
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={createProfileForm.control}
                      name="sessionDuration"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Session Duration (minutes)</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              placeholder="50" 
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 50)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <FormField
                    control={createProfileForm.control}
                    name="workingDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Working Days</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Monday, Tuesday, Wednesday, Thursday, Friday"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.split(',').map(s => s.trim()).filter(s => s.length > 0))}
                            value={field.value?.join(', ') || ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>
                
                <TabsContent value="contact" className="space-y-4">
                  <div className="text-sm text-gray-600 mb-4">
                    Emergency contact information for this staff member
                  </div>
                  
                  <FormField
                    control={createProfileForm.control}
                    name="emergencyContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Name</FormLabel>
                        <FormControl>
                          <Input placeholder="John Doe" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createProfileForm.control}
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
                    
                    <FormField
                      control={createProfileForm.control}
                      name="emergencyContactRelationship"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Relationship</FormLabel>
                          <FormControl>
                            <Input placeholder="Spouse, Parent, etc." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>
              </Tabs>
              
              <div className="flex gap-2 pt-4">
                <Button 
                  type="submit" 
                  disabled={createProfileMutation.isPending || updateProfileMutation.isPending}
                >
                  {createProfileMutation.isPending || updateProfileMutation.isPending 
                    ? "Saving..." 
                    : selectedUser?.profile ? "Update Profile" : "Create Profile"}
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsProfileModalOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the user account for {userToDelete?.fullName}. 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => userToDelete && deleteUserMutation.mutate(userToDelete.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
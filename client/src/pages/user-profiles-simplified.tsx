import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Settings, Shield, User, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { UserCard } from "@/components/user-profiles/UserCard";
import { ProfileDialog } from "@/components/user-profiles/ProfileDialog";
import { BasicInfoDialog } from "@/components/user-profiles/BasicInfoDialog";
import { useToast } from "@/hooks/use-toast";
import SupervisorAssignments from "@/components/supervision/supervisor-assignments";

// User creation form schema
const createUserFormSchema = z.object({
  username: z.string().min(1, "Username is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  fullName: z.string().min(1, "Full name is required"),
  role: z.enum(["therapist", "supervisor", "admin"]),
});

type CreateUserFormData = z.infer<typeof createUserFormSchema>;

// Profile form schema (simplified)
const profileFormSchema = z.object({
  licenseNumber: z.string().optional(),
  licenseType: z.string().optional(),
  licenseState: z.string().optional(),
  licenseExpiry: z.string().optional(),
  yearsOfExperience: z.number().default(0),
  maxClientsPerDay: z.number().default(0),
  sessionDuration: z.number().default(50),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  clinicalExperience: z.string().optional(),
  researchBackground: z.string().optional(),
  supervisoryExperience: z.string().optional(),
  careerObjectives: z.string().optional(),
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

interface UserWithProfile {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  lastLogin: string | null;
  profile?: any;
}

export default function UserProfilesSimplified() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // State management
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isBasicInfoModalOpen, setIsBasicInfoModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithProfile | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserWithProfile | null>(null);

  // Forms
  const createUserForm = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserFormSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      fullName: "",
      role: "therapist",
    },
  });

  // Data fetching
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["/api/users"],
  });

  // Filter users based on search term
  const filteredUsers = (users as UserWithProfile[]).filter((user: UserWithProfile) =>
    user.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Mutations
  const createUserMutation = useMutation({
    mutationFn: async (data: CreateUserFormData) => {
      return await apiRequest("/api/users", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsCreateModalOpen(false);
      createUserForm.reset();
      toast({
        title: "Success",
        description: "User created successfully",
      });
    },
    onError: (error: any) => {

      toast({
        title: "Error Creating User",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    },
  });

  const createProfileMutation = useMutation({
    mutationFn: async (data: { userId: number; profile: ProfileFormData }) => {
      return await apiRequest(`/api/users/${data.userId}/profile`, "POST", data.profile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsProfileModalOpen(false);
      setSelectedUser(null);
      toast({
        title: "Success",
        description: "Profile created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create profile",
        variant: "destructive",
      });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { userId: number; profile: Partial<ProfileFormData> }) => {
      return await apiRequest(`/api/users/${data.userId}/profile`, "PUT", data.profile);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsProfileModalOpen(false);
      setSelectedUser(null);
      toast({
        title: "Success",
        description: "Profile updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  const updateBasicInfoMutation = useMutation({
    mutationFn: async (data: { userId: number; basicInfo: { fullName: string; email: string } }) => {
      return await apiRequest(`/api/users/${data.userId}`, "PUT", data.basicInfo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsBasicInfoModalOpen(false);
      setSelectedUser(null);
      toast({
        title: "Success",
        description: "User basic information updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user basic information",
        variant: "destructive",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      return await apiRequest(`/api/users/${userId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setUserToDelete(null);
      toast({
        title: "Success",
        description: "User deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    },
  });

  // Event handlers
  const handleCreateUser = (data: CreateUserFormData) => {

    createUserMutation.mutate(data);
  };

  const handleEditProfile = (user: UserWithProfile) => {
    setSelectedUser(user);
    setIsProfileModalOpen(true);
  };

  const handleEditBasicInfo = (user: UserWithProfile) => {
    setSelectedUser(user);
    setIsBasicInfoModalOpen(true);
  };

  const handleProfileSubmit = (data: ProfileFormData) => {
    if (selectedUser) {
      if (selectedUser.profile) {
        updateProfileMutation.mutate({ userId: selectedUser.id, profile: data });
      } else {
        createProfileMutation.mutate({ userId: selectedUser.id, profile: data });
      }
    }
  };

  const handleBasicInfoSubmit = (data: { fullName: string; email: string }) => {
    if (selectedUser) {
      updateBasicInfoMutation.mutate({ userId: selectedUser.id, basicInfo: data });
    }
  };

  const handleDeleteUser = (user: UserWithProfile) => {
    setUserToDelete(user);
  };

  const confirmDeleteUser = () => {
    if (userToDelete) {
      deleteUserMutation.mutate(userToDelete.id);
    }
  };

  // User status toggle handler
  const handleToggleUserStatus = async (user: UserWithProfile, newStatus: string) => {
    try {
      await apiRequest(`/api/users/${user.id}`, "PUT", { status: newStatus });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: `User ${user.fullName} status updated to ${newStatus}`,
      });
    } catch (error: any) {
      toast({
        title: "Error", 
        description: error.message || "Failed to update user status",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading users...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-12 px-4">
      <Tabs defaultValue="profiles" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="profiles">User Profiles</TabsTrigger>
          <TabsTrigger value="supervisors">Supervisor Assignments</TabsTrigger>
        </TabsList>
        
        <TabsContent value="profiles" className="space-y-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">User Profiles</h1>
              <p className="text-muted-foreground">
                Manage user accounts, professional profiles, and role permissions
              </p>
            </div>

        <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
            </DialogHeader>
            <Form {...createUserForm}>
              <form onSubmit={createUserForm.handleSubmit(handleCreateUser)} className="space-y-4">
                <FormField
                  control={createUserForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter username" {...field} />
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
                        <Input type="email" placeholder="Enter email" {...field} />
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
                        <Input type="password" placeholder="Enter password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createUserForm.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter full name" {...field} />
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
                      <FormControl>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="therapist">Therapist</SelectItem>
                            <SelectItem value="supervisor">Supervisor</SelectItem>
                            <SelectItem value="admin">Administrator</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2 pt-4">
                  <Button type="submit" disabled={createUserMutation.isPending}>
                    {createUserMutation.isPending ? "Creating..." : "Create User"}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsCreateModalOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Role Permissions Table */}
      <div className="mb-8 bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">TherapyFlow Role Permissions Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-red-600" />
              <h3 className="font-medium text-red-800">Administrator</h3>
            </div>
            <ul className="space-y-1 text-sm text-gray-600">
              <li>• Full system access</li>
              <li>• User management</li>
              <li>• System settings</li>
              <li>• All client data</li>
              <li>• Billing management</li>
              <li>• Report generation</li>
            </ul>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600" />
              <h3 className="font-medium text-blue-800">Supervisor</h3>
            </div>
            <ul className="space-y-1 text-sm text-gray-600">
              <li>• Supervise therapists</li>
              <li>• View assigned caseloads</li>
              <li>• Clinical oversight</li>
              <li>• Progress review</li>
              <li>• Training management</li>
            </ul>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-green-600" />
              <h3 className="font-medium text-green-800">Therapist</h3>
            </div>
            <ul className="space-y-1 text-sm text-gray-600">
              <li>• Manage own clients</li>
              <li>• Session scheduling</li>
              <li>• Clinical documentation</li>
              <li>• Assessment tools</li>
              <li>• Progress tracking</li>
            </ul>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-purple-600" />
              <h3 className="font-medium text-purple-800">Client</h3>
            </div>
            <ul className="space-y-1 text-sm text-gray-600">
              <li>• View own profile</li>
              <li>• Complete assessments</li>
              <li>• View appointments</li>
              <li>• Access resources</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <Input
          placeholder="Search users by name, username, or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUsers.map((user: UserWithProfile) => (
          <UserCard
            key={user.id}
            user={user}
            onEditProfile={handleEditProfile}
            onEditBasicInfo={handleEditBasicInfo}
            onDeleteUser={handleDeleteUser}
            onToggleStatus={handleToggleUserStatus}
          />
        ))}
      </div>

      {filteredUsers.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchTerm ? "No users found matching your search." : "No users found."}
          </p>
        </div>
      )}

      {/* Profile Dialog */}
      <ProfileDialog
        isOpen={isProfileModalOpen}
        onClose={() => {
          setIsProfileModalOpen(false);
          setSelectedUser(null);
        }}
        selectedUser={selectedUser}
        onSubmit={handleProfileSubmit}
        isLoading={createProfileMutation.isPending || updateProfileMutation.isPending}
      />

      {/* Basic Info Dialog */}
      <BasicInfoDialog
        isOpen={isBasicInfoModalOpen}
        onClose={() => {
          setIsBasicInfoModalOpen(false);
          setSelectedUser(null);
        }}
        selectedUser={selectedUser}
        onSubmit={handleBasicInfoSubmit}
        isLoading={updateBasicInfoMutation.isPending}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!userToDelete} onOpenChange={() => setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {userToDelete?.fullName}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteUser} className="bg-destructive text-destructive-foreground">
              {deleteUserMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </TabsContent>
        
        <TabsContent value="supervisors" className="space-y-6">
          <SupervisorAssignments />
        </TabsContent>
      </Tabs>
    </div>
  );
}
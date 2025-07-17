import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// Profile form schema
const profileFormSchema = z.object({
  licenseNumber: z.string().optional(),
  licenseType: z.string().optional(),
  licenseState: z.string().optional(),
  licenseExpiry: z.string().optional(),
  specializations: z.array(z.string()).default([]),
  treatmentApproaches: z.array(z.string()).default([]),
  ageGroups: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  education: z.array(z.string()).default([]),
  yearsOfExperience: z.number().default(0),
  workingDays: z.array(z.string()).default([]),
  maxClientsPerDay: z.number().default(0),
  sessionDuration: z.number().default(50),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  previousPositions: z.array(z.string()).default([]),
  clinicalExperience: z.string().optional(),
  researchBackground: z.string().optional(),
  publications: z.array(z.string()).default([]),
  professionalMemberships: z.array(z.string()).default([]),
  continuingEducation: z.array(z.string()).default([]),
  supervisoryExperience: z.string().optional(),
  awardRecognitions: z.array(z.string()).default([]),
  professionalReferences: z.array(z.string()).default([]),
  careerObjectives: z.string().optional(),
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

interface ProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUser: UserWithProfile | null;
  onSubmit: (data: ProfileFormData) => void;
  isLoading: boolean;
}

export function ProfileDialog({ isOpen, onClose, selectedUser, onSubmit, isLoading }: ProfileDialogProps) {
  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      licenseNumber: "",
      licenseType: "",
      licenseState: "",
      licenseExpiry: "",
      specializations: [],
      treatmentApproaches: [],
      ageGroups: [],
      languages: [],
      certifications: [],
      education: [],
      yearsOfExperience: 0,
      workingDays: [],
      maxClientsPerDay: 0,
      sessionDuration: 50,
      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelationship: "",
      previousPositions: [],
      clinicalExperience: "",
      researchBackground: "",
      publications: [],
      professionalMemberships: [],
      continuingEducation: [],
      supervisoryExperience: "",
      awardRecognitions: [],
      professionalReferences: [],
      careerObjectives: "",
    },
  });

  const handleSubmit = (data: ProfileFormData) => {
    onSubmit(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {selectedUser?.profile ? "Edit" : "Create"} Professional Profile for {selectedUser?.fullName}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <Tabs defaultValue="license" className="w-full">
              <TabsList className="grid w-full grid-cols-6">
                <TabsTrigger value="license">License</TabsTrigger>
                <TabsTrigger value="specializations">Specializations</TabsTrigger>
                <TabsTrigger value="background">Background</TabsTrigger>
                <TabsTrigger value="credentials">Credentials</TabsTrigger>
                <TabsTrigger value="schedule">Schedule</TabsTrigger>
                <TabsTrigger value="contact">Contact</TabsTrigger>
              </TabsList>

              <TabsContent value="license" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="licenseNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Number</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter license number" {...field} />
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
                        <FormControl>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select license type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="lpc">Licensed Professional Counselor (LPC)</SelectItem>
                              <SelectItem value="lcsw">Licensed Clinical Social Worker (LCSW)</SelectItem>
                              <SelectItem value="lmft">Licensed Marriage and Family Therapist (LMFT)</SelectItem>
                              <SelectItem value="psyd">Doctor of Psychology (PsyD)</SelectItem>
                              <SelectItem value="phd">Doctor of Philosophy (PhD)</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="licenseState"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License State</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., CA, NY, TX" {...field} />
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
              </TabsContent>

              <TabsContent value="specializations" className="space-y-4">
                <FormField
                  control={form.control}
                  name="yearsOfExperience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Years of Experience</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="Enter years of experience"
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
                  name="clinicalExperience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Clinical Experience Summary</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Describe your clinical experience and areas of expertise..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="background" className="space-y-4">
                <FormField
                  control={form.control}
                  name="researchBackground"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Research Background</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Describe your research background and interests..."
                          className="min-h-[100px]"
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
                          placeholder="Describe your supervisory experience..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="credentials" className="space-y-4">
                <FormField
                  control={form.control}
                  name="careerObjectives"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Career Objectives</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Describe your professional goals and career objectives..."
                          className="min-h-[100px]"
                          {...field}
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
                    control={form.control}
                    name="maxClientsPerDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max Clients Per Day</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="Enter maximum clients per day"
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
                            placeholder="e.g., 50"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 50)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="contact" className="space-y-4">
                <div className="grid grid-cols-1 gap-4">
                  <FormField
                    control={form.control}
                    name="emergencyContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emergency Contact Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter emergency contact name" {...field} />
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
                          <Input placeholder="Enter emergency contact phone" {...field} />
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
                        <FormLabel>Emergency Contact Relationship</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Spouse, Parent, Sibling" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Saving..." : "Save Profile"}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
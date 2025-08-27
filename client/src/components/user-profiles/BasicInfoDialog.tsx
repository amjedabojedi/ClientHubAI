import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const basicInfoSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
});

type BasicInfoData = z.infer<typeof basicInfoSchema>;

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

interface BasicInfoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUser: UserWithProfile | null;
  onSubmit: (data: BasicInfoData) => void;
  isLoading: boolean;
}

export function BasicInfoDialog({ isOpen, onClose, selectedUser, onSubmit, isLoading }: BasicInfoDialogProps) {
  const form = useForm<BasicInfoData>({
    resolver: zodResolver(basicInfoSchema),
    defaultValues: {
      fullName: "",
      email: "",
    },
  });

  // Update form when selectedUser changes
  useEffect(() => {
    if (selectedUser) {
      form.reset({
        fullName: selectedUser.fullName || "",
        email: selectedUser.email || "",
      });
    }
  }, [selectedUser, form]);

  const handleSubmit = (data: BasicInfoData) => {
    onSubmit(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Basic Information</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <div className="space-y-4">
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

              <div className="bg-gray-50 p-3 rounded-lg">
                <Label className="text-sm text-gray-600">Username (read-only)</Label>
                <div className="mt-1 text-sm font-medium">{selectedUser?.username || "N/A"}</div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { User, Shield, Settings, Edit, Trash2, UserCheck, UserX } from "lucide-react";

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

interface UserCardProps {
  user: UserWithProfile;
  onEditProfile: (user: UserWithProfile) => void;
  onEditBasicInfo: (user: UserWithProfile) => void;
  onDeleteUser: (user: UserWithProfile) => void;
  onToggleStatus: (user: UserWithProfile, newStatus: string) => void;
}

export function UserCard({ user, onEditProfile, onEditBasicInfo, onDeleteUser, onToggleStatus }: UserCardProps) {
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
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getRolePermissions = (role: string) => {
    switch (role) {
      case "admin":
        return [
          "Full system access",
          "User management",
          "System settings",
          "All client data",
          "Billing management",
          "Report generation"
        ];
      case "supervisor":
        return [
          "Supervise therapists",
          "View assigned caseloads",
          "Clinical oversight",
          "Progress review",
          "Training management"
        ];
      case "therapist":
        return [
          "Manage own clients", 
          "Session scheduling",
          "Clinical documentation",
          "Assessment tools",
          "Progress tracking"
        ];
      case "client":
        return [
          "View own profile",
          "Complete assessments",
          "View appointments",
          "Access resources"
        ];
      default:
        return [];
    }
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium">{user.fullName}</CardTitle>
          <div className="flex gap-2">
            <Badge className={getRoleBadgeColor(user.role)}>
              <div className="flex items-center gap-1">
                {getRoleIcon(user.role)}
                <span className="capitalize">{user.role}</span>
              </div>
            </Badge>
            <Badge className={getStatusBadgeColor(user.status)}>
              <span className="capitalize">{user.status}</span>
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 text-sm">
          <div>
            <span className="font-medium text-gray-600">Username:</span>
            <span className="ml-2">{user.username}</span>
          </div>
          <div>
            <span className="font-medium text-gray-600">Email:</span>
            <span className="ml-2">{user.email}</span>
          </div>
          <div>
            <span className="font-medium text-gray-600">Last Login:</span>
            <span className="ml-2">
              {user.lastLogin 
                ? new Date(user.lastLogin).toLocaleDateString()
                : "Never"
              }
            </span>
          </div>
          
          {/* Role Permissions */}
          <div className="pt-2 border-t">
            <span className="font-medium text-gray-600 block mb-2">Role Permissions:</span>
            <ul className="space-y-1 text-xs text-gray-500">
              {getRolePermissions(user.role).map((permission, index) => (
                <li key={index} className="flex items-center gap-1">
                  <div className="w-1 h-1 bg-gray-400 rounded-full" />
                  {permission}
                </li>
              ))}
            </ul>
          </div>

          {/* User Status Control */}
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-600">Status Control:</span>
              <div className="flex items-center gap-2">
                <Switch
                  checked={user.status === 'active'}
                  onCheckedChange={(checked) => {
                    const newStatus = checked ? 'active' : 'inactive';
                    onToggleStatus(user, newStatus);
                  }}
                />
                <span className="text-xs text-gray-500">
                  {user.status === 'active' ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditBasicInfo(user)}
            className="w-full"
          >
            <Edit className="w-4 h-4 mr-1" />
            Edit Basic Info
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEditProfile(user)}
              className="flex-1"
            >
              <Edit className="w-4 h-4 mr-1" />
              Professional Details
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDeleteUser(user)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
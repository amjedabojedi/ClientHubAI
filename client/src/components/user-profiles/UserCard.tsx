import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { User, Shield, Settings, Edit, Trash2 } from "lucide-react";

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
  onDeleteUser: (user: UserWithProfile) => void;
}

export function UserCard({ user, onEditProfile, onDeleteUser }: UserCardProps) {
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
        return "bg-gray-100 text-gray-800";
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
        <div className="space-y-2 text-sm">
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
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditProfile(user)}
            className="flex-1"
          >
            <Edit className="w-4 h-4 mr-1" />
            Edit Professional Details
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDeleteUser(user)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
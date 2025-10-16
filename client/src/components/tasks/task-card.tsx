/**
 * TaskCard Component
 * 
 * A reusable task card component that displays task information in a consistent
 * format across the application. Used in Tasks page, Client Detail page, and Task History.
 * 
 * Features:
 * - Visual status indicator (colored dot)
 * - Priority and status badges
 * - Client name with navigation link
 * - Due date and assignee information
 * - Task description
 * - Creation and completion dates (America/New_York timezone)
 * - Comment count and recent comments preview
 * - Action buttons (Comments, View, Edit, Delete)
 * 
 * Layout: 75% content width / 25% action buttons
 */

import { useLocation } from "wouter";
import { 
  Calendar,
  Edit,
  Eye,
  MessageSquare, 
  MoreVertical, 
  Target,
  Trash2 
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatDateDisplay } from "@/lib/datetime";

import type { Task, Client, User as UserType } from "@shared/schema";

// Task comment structure as returned by API
interface TaskComment {
  id: number;
  content: string;
  createdAt: string;
  author: {
    fullName: string;
  };
}

// Extended task with relations and computed fields
export interface TaskWithDetails extends Task {
  assignedTo?: UserType;
  client: Client;
  commentCount?: number;
  recentComments?: TaskComment[];
}

interface TaskCardProps {
  task: TaskWithDetails;
  onEdit: (task: TaskWithDetails) => void;
  onDelete: (taskId: number) => void;
  onViewComments: (task: TaskWithDetails) => void;
  onViewTask: (task: TaskWithDetails) => void;
  /** Origin page for breadcrumb navigation (e.g., 'tasks', 'tasks-history') */
  fromPage?: string;
}

/**
 * Returns color classes for priority badge
 */
function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'urgent': return 'bg-red-50 text-red-700 border-red-200';
    case 'high': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'medium': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    default: return 'bg-green-50 text-green-700 border-green-200';
  }
}

/**
 * Returns color classes for status badge and indicator dot
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-500';
    case 'in_progress': return 'bg-blue-500';
    case 'overdue': return 'bg-red-500';
    default: return 'bg-yellow-500';
  }
}

function getStatusBadgeColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-50 text-green-700 border-green-200';
    case 'in_progress': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'overdue': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  }
}

/**
 * Capitalizes the first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function TaskCard({ 
  task, 
  onEdit, 
  onDelete, 
  onViewComments, 
  onViewTask,
  fromPage = 'tasks'
}: TaskCardProps) {
  const [, setLocation] = useLocation();

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-2">
        {/* Left side: Task content (75% width) */}
        <div className="flex items-center space-x-3" style={{ width: '75%' }}>
          {/* Status indicator dot */}
          <div 
            className={cn(
              "w-3 h-3 rounded-full flex-shrink-0",
              getStatusColor(task.status)
            )}
          />
          
          {/* Task details */}
          <div className="flex-1 min-w-0">
            {/* Title and badges row */}
            <div className="flex items-center gap-2 mb-1">
              <h4 
                className="font-semibold text-slate-900 hover:text-primary cursor-pointer"
                onClick={() => onEdit(task)}
                data-testid={`task-title-${task.id}`}
              >
                {task.title}
              </h4>
              <span className="text-slate-300">•</span>
              
              {/* Priority badge */}
              <Badge 
                variant="outline"
                className={getPriorityColor(task.priority)}
              >
                {capitalize(task.priority)}
              </Badge>
              
              {/* Status badge */}
              <Badge 
                variant="outline"
                className={getStatusBadgeColor(task.status)}
              >
                {capitalize(task.status.replace('_', ' '))}
              </Badge>
            </div>
            
            {/* Client, due date, and assignee info */}
            <div className="text-sm space-y-1">
              <p className="text-slate-600">
                {/* Client name link with breadcrumb navigation */}
                <span 
                  className="hover:text-primary cursor-pointer font-medium"
                  onClick={() => setLocation(`/clients/${task.client.id}?from=${fromPage}`)}
                  data-testid={`client-link-${task.id}`}
                >
                  {task.client.fullName}
                </span>
                
                {/* Due date */}
                {task.dueDate && (
                  <span className="text-slate-500 ml-2">
                    <Calendar className="w-3 h-3 inline mr-1" />
                    {formatDateDisplay(task.dueDate)}
                  </span>
                )}
                
                {/* Assignee */}
                {task.assignedTo && (
                  <span className="text-slate-500 ml-2">
                    <Target className="w-3 h-3 inline mr-1" />
                    {task.assignedTo.fullName}
                  </span>
                )}
              </p>
              
              {/* Task description */}
              {task.description && (
                <>
                  <div className="border-t border-slate-200 my-2" />
                  <p className="text-slate-600 italic">{task.description}</p>
                </>
              )}
              
              {/* Creation and completion dates */}
              {task.createdAt && (
                <div className="flex items-center gap-4 text-xs text-slate-600 font-medium mt-2 pt-2 border-t border-slate-100">
                  <span>Created: {formatDateDisplay(task.createdAt)}</span>
                  {task.completedAt && (
                    <span className="text-green-600">
                      Completed: {formatDateDisplay(task.completedAt)}
                    </span>
                  )}
                </div>
              )}
              
              {/* Comments section */}
              {(task.commentCount !== undefined && task.commentCount > 0) && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <MessageSquare className="w-3 h-3" />
                    <span className="font-semibold">Comments:</span>
                    <span>{task.commentCount}</span>
                  </div>
                  
                  {/* Recent comments preview (last 2) */}
                  {task.recentComments && task.recentComments.length > 0 && (
                    <div className="ml-4 space-y-2">
                      {task.recentComments.map((comment) => (
                        <div key={comment.id} className="text-xs border-l-2 border-slate-300 pl-2">
                          <div className="text-slate-600 italic">"{comment.content}"</div>
                          <div className="text-slate-500 mt-0.5">
                            {comment.author.fullName}, {formatDateDisplay(comment.createdAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Right side: Action buttons (25% width) */}
        <div className="flex items-center gap-2">
          {/* Primary action: Comments */}
          <Button
            variant="default"
            size="sm"
            onClick={() => onViewComments(task)}
            data-testid={`button-comments-${task.id}`}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Comments
          </Button>
          
          {/* Secondary actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem 
                onClick={() => onViewTask(task)} 
                data-testid={`menu-view-${task.id}`}
              >
                <Eye className="w-4 h-4 mr-2" />
                View Task
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onEdit(task)} 
                data-testid={`menu-edit-${task.id}`}
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit Task
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onDelete(task.id)}
                className="text-red-600"
                data-testid={`menu-delete-${task.id}`}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

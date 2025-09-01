import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

// Icons
import { 
  MessageSquare, 
  Send, 
  Edit3, 
  Trash2, 
  Eye, 
  EyeOff, 
  Clock 
} from "lucide-react";

// Utils & Types
import { apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import type { TaskComment, User } from "@shared/schema";

interface TaskCommentsProps {
  taskId: number;
  taskTitle: string;
}

interface CommentWithAuthor extends TaskComment {
  author: User;
}

export function TaskComments({ taskId, taskTitle }: TaskCommentsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [newComment, setNewComment] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  // ===== FETCH TASK COMMENTS =====
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["/api/tasks", taskId, "comments"],
    queryFn: async () => {
      const response = await apiRequest(`/api/tasks/${taskId}/comments`, "GET");
      return response.json() as Promise<CommentWithAuthor[]>;
    },
  });

  // ===== CREATE COMMENT MUTATION =====
  const createCommentMutation = useMutation({
    mutationFn: async (commentData: { content: string; authorId: number; isInternal: boolean }) => {
      const response = await apiRequest(`/api/tasks/${taskId}/comments`, "POST", commentData);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Comment added successfully!" });
      setNewComment("");
      setIsInternal(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "comments"] });
    },
    onError: () => {
      toast({ title: "Error adding comment", variant: "destructive" });
    },
  });

  // ===== UPDATE COMMENT MUTATION =====
  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, content }: { commentId: number; content: string }) => {
      const response = await apiRequest(`/api/tasks/${taskId}/comments/${commentId}`, "PUT", { content });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Comment updated successfully!" });
      setEditingComment(null);
      setEditContent("");
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "comments"] });
    },
    onError: () => {
      toast({ title: "Error updating comment", variant: "destructive" });
    },
  });

  // ===== DELETE COMMENT MUTATION =====
  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: number) => {
      await apiRequest(`/api/tasks/${taskId}/comments/${commentId}`, "DELETE");
    },
    onSuccess: () => {
      toast({ title: "Comment deleted successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "comments"] });
    },
    onError: () => {
      toast({ title: "Error deleting comment", variant: "destructive" });
    },
  });

  // ===== EVENT HANDLERS =====
  const handleAddComment = () => {
    if (!newComment.trim()) return;
    if (!user?.id) {
      toast({ title: "Error: User not authenticated", variant: "destructive" });
      return;
    }
    
    createCommentMutation.mutate({
      content: newComment.trim(),
      authorId: user.id,
      isInternal,
    });
  };

  const handleEditComment = (comment: CommentWithAuthor) => {
    setEditingComment(comment.id);
    setEditContent(comment.content);
  };

  const handleSaveEdit = () => {
    if (!editContent.trim() || !editingComment) return;
    
    updateCommentMutation.mutate({
      commentId: editingComment,
      content: editContent.trim(),
    });
  };

  const handleDeleteComment = (commentId: number) => {
    if (confirm("Are you sure you want to delete this comment?")) {
      deleteCommentMutation.mutate(commentId);
    }
  };

  // ===== RENDER COMPONENT =====
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          Task Comments
        </CardTitle>
        <p className="text-sm text-slate-600">{taskTitle}</p>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* ===== NEW COMMENT FORM ===== */}
        <div className="space-y-4">
          <Textarea
            placeholder="Add a comment to track progress or communicate with team members..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="min-h-[100px]"
          />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                checked={isInternal}
                onCheckedChange={setIsInternal}
                id="internal-comment"
              />
              <label htmlFor="internal-comment" className="text-sm">
                Internal staff note (not visible to client)
              </label>
            </div>
            
            <Button
              onClick={handleAddComment}
              disabled={!newComment.trim() || createCommentMutation.isPending}
            >
              <Send className="w-4 h-4 mr-2" />
              {createCommentMutation.isPending ? "Adding..." : "Add Comment"}
            </Button>
          </div>
        </div>

        <Separator />

        {/* ===== COMMENTS LIST ===== */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-4 text-slate-600">Loading comments...</div>
          ) : comments.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="w-12 h-12 mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No comments yet</h3>
              <p className="text-slate-600">Be the first to add a comment to track progress.</p>
            </div>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="flex gap-3 p-4 bg-slate-50 rounded-lg">
                {/* Author Avatar */}
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="text-xs">
                    {comment.author.fullName?.split(' ').map(n => n[0]).join('') || 'U'}
                  </AvatarFallback>
                </Avatar>

                {/* Comment Content */}
                <div className="flex-1 space-y-2">
                  {/* Comment Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">
                        {comment.author.fullName}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                      </span>
                      {comment.isInternal && (
                        <Badge variant="secondary" className="text-xs">
                          <EyeOff className="w-3 h-3 mr-1" />
                          Internal
                        </Badge>
                      )}
                    </div>

                    {/* Comment Actions */}
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditComment(comment)}
                        disabled={editingComment === comment.id}
                      >
                        <Edit3 className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteComment(comment.id)}
                        disabled={deleteCommentMutation.isPending}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Comment Body */}
                  {editingComment === comment.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-[80px]"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleSaveEdit}
                          disabled={!editContent.trim() || updateCommentMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingComment(null);
                            setEditContent("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-700 whitespace-pre-wrap">{comment.content}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
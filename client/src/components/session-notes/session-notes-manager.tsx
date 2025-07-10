// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Icons
import { Plus, Edit, Trash2, FileText, Clock, User, Target, Brain, Shield } from "lucide-react";

// Utils
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// Hooks and Data
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Types and Validation
import { z } from "zod";
import { insertSessionNoteSchema } from "@shared/schema";
import { format } from "date-fns";

// Session Note Types
interface SessionNote {
  id: number;
  sessionId: number;
  clientId: number;
  therapistId: number;
  noteType: 'progress' | 'assessment' | 'intervention' | 'homework' | 'crisis' | 'general';
  content: string;
  
  // Core clinical documentation fields
  sessionFocus?: string;
  symptoms?: string;
  shortTermGoals?: string;
  intervention?: string;
  progress?: string;
  remarks?: string;
  recommendations?: string;
  
  // Mood tracking
  moodBefore?: number;
  moodAfter?: number;
  
  // Additional clinical fields
  goals?: string;
  interventions?: string;
  assessments?: string;
  homework?: string;
  followUpNeeded?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  confidentialityLevel: 'standard' | 'restricted' | 'highly_confidential';
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  therapist: {
    id: number;
    fullName: string;
  };
  session: {
    id: number;
    sessionDate: string;
    sessionType: string;
  };
}

interface Session {
  id: number;
  clientId: number;
  sessionDate: string;
  sessionType: string;
  status: string;
}

// Form Schema
const sessionNoteFormSchema = insertSessionNoteSchema.extend({
  content: z.string().min(10, "Note content must be at least 10 characters"),
  moodBefore: z.number().min(1).max(10).optional(),
  moodAfter: z.number().min(1).max(10).optional(),
});

type SessionNoteFormData = z.infer<typeof sessionNoteFormSchema>;

// Session Notes Manager Component
interface SessionNotesManagerProps {
  clientId: number;
  sessions: Session[];
  preSelectedSessionId?: number;
}

export default function SessionNotesManager({ clientId, sessions, preSelectedSessionId }: SessionNotesManagerProps) {
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<SessionNote | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch session notes for the client
  const { data: sessionNotes = [], isLoading } = useQuery({
    queryKey: ['/api/clients', clientId, 'session-notes'],
    queryFn: () => apiRequest('GET', `/api/clients/${clientId}/session-notes`),
  });

  // Create session note mutation
  const createSessionNoteMutation = useMutation({
    mutationFn: (data: SessionNoteFormData) => apiRequest('POST', '/api/session-notes', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients', clientId, 'session-notes'] });
      setIsAddNoteOpen(false);
      toast({ title: "Session note created successfully" });
    },
    onError: () => {
      toast({ title: "Error creating session note", variant: "destructive" });
    },
  });

  // Update session note mutation
  const updateSessionNoteMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SessionNoteFormData> }) =>
      apiRequest('PUT', `/api/session-notes/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients', clientId, 'session-notes'] });
      setEditingNote(null);
      toast({ title: "Session note updated successfully" });
    },
    onError: () => {
      toast({ title: "Error updating session note", variant: "destructive" });
    },
  });

  // Delete session note mutation
  const deleteSessionNoteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/session-notes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients', clientId, 'session-notes'] });
      toast({ title: "Session note deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error deleting session note", variant: "destructive" });
    },
  });

  // Form setup
  const form = useForm<SessionNoteFormData>({
    resolver: zodResolver(sessionNoteFormSchema),
    defaultValues: {
      clientId,
      therapistId: 3, // Mock therapist ID - in real app this would come from auth
      noteType: 'general',
      content: '',
      confidentialityLevel: 'standard',
      isPrivate: false,
      followUpNeeded: false,
      riskLevel: 'low',
    },
  });

  // Reset form for new note
  const resetFormForNewNote = () => {
    form.reset({
      sessionId: preSelectedSessionId || undefined,
      clientId,
      therapistId: 3,
      noteType: 'general',
      content: '',
      confidentialityLevel: 'standard',
      isPrivate: false,
      followUpNeeded: false,
      riskLevel: 'low',
    });
  };

  // Reset form for editing
  const resetFormForEdit = (note: SessionNote) => {
    form.reset({
      sessionId: note.sessionId,
      clientId: note.clientId,
      therapistId: note.therapistId,
      noteType: note.noteType,
      content: note.content,
      moodBefore: note.moodBefore,
      moodAfter: note.moodAfter,
      goals: note.goals,
      interventions: note.interventions,
      assessments: note.assessments,
      homework: note.homework,
      followUpNeeded: note.followUpNeeded,
      riskLevel: note.riskLevel,
      confidentialityLevel: note.confidentialityLevel,
      isPrivate: note.isPrivate,
    });
  };

  // Handle form submission
  const onSubmit = (data: SessionNoteFormData) => {
    if (editingNote) {
      updateSessionNoteMutation.mutate({ id: editingNote.id, data });
    } else {
      createSessionNoteMutation.mutate(data);
    }
  };

  // Handle add note
  const handleAddNote = () => {
    resetFormForNewNote();
    setEditingNote(null);
    setIsAddNoteOpen(true);
  };

  // Handle edit note
  const handleEditNote = (note: SessionNote) => {
    resetFormForEdit(note);
    setEditingNote(note);
    setIsAddNoteOpen(true);
  };

  // Handle delete note
  const handleDeleteNote = (id: number) => {
    if (confirm('Are you sure you want to delete this session note?')) {
      deleteSessionNoteMutation.mutate(id);
    }
  };

  // Get note type icon
  const getNoteTypeIcon = (type: string) => {
    switch (type) {
      case 'progress': return <Target className="h-4 w-4" />;
      case 'assessment': return <Brain className="h-4 w-4" />;
      case 'intervention': return <User className="h-4 w-4" />;
      case 'homework': return <FileText className="h-4 w-4" />;
      case 'crisis': return <Shield className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  // Get risk level color
  const getRiskLevelColor = (level?: string) => {
    switch (level) {
      case 'high': return 'destructive';
      case 'medium': return 'default';
      case 'low': return 'secondary';
      default: return 'secondary';
    }
  };

  // Filter notes by selected session - ensure sessionNotes is an array
  const notesArray = Array.isArray(sessionNotes) ? sessionNotes : [];
  const filteredNotes = selectedSession 
    ? notesArray.filter((note: SessionNote) => note.sessionId === selectedSession)
    : notesArray;

  if (isLoading) {
    return <div className="space-y-4">
      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
    </div>;
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-lg font-semibold">Session Notes</h3>
          <p className="text-sm text-muted-foreground">
            View and manage detailed notes from completed therapy sessions
          </p>
        </div>
        <Button onClick={handleAddNote} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Session Note
        </Button>
      </div>

      {/* Session Filter */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <Label htmlFor="session-filter" className="text-sm font-medium">
          Filter by Session:
        </Label>
        <Select value={selectedSession?.toString() || 'all'} onValueChange={(value) => 
          setSelectedSession(value === 'all' ? null : parseInt(value))
        }>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="All sessions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sessions</SelectItem>
            {sessions.map((session) => (
              <SelectItem key={session.id} value={session.id.toString()}>
                {format(new Date(session.sessionDate), 'MMM dd, yyyy')} - {session.sessionType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Session Notes List */}
      <div className="space-y-4">
        {filteredNotes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground mb-2">No session notes yet</h3>
              <p className="text-sm text-muted-foreground text-center mb-4">
                Session notes will appear here after you complete sessions and add documentation from the Sessions tab.
              </p>
              <Button onClick={handleAddNote} variant="outline">
                Create First Note
              </Button>
            </CardContent>
          </Card>
        ) : (
          filteredNotes.map((note: SessionNote) => (
            <Card key={note.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {getNoteTypeIcon(note.noteType)}
                    <CardTitle className="text-base capitalize">
                      {note.noteType} Note
                    </CardTitle>
                    <Badge variant={getRiskLevelColor(note.riskLevel)}>
                      {note.riskLevel} risk
                    </Badge>
                    {note.isPrivate && (
                      <Badge variant="outline">
                        <Shield className="h-3 w-3 mr-1" />
                        Private
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditNote(note)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteNote(note.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardDescription className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(note.session.sessionDate), 'MMM dd, yyyy')}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {note.therapist.fullName}
                  </span>
                  <span className="capitalize">{note.session.sessionType}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Main Content */}
                <div>
                  <h4 className="font-medium mb-2">Session Notes</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {note.content}
                  </p>
                </div>

                {/* Mood Tracking */}
                {(note.moodBefore || note.moodAfter) && (
                  <div>
                    <h4 className="font-medium mb-2">Mood Assessment</h4>
                    <div className="flex gap-4 text-sm">
                      {note.moodBefore && (
                        <span>Before: <strong>{note.moodBefore}/10</strong></span>
                      )}
                      {note.moodAfter && (
                        <span>After: <strong>{note.moodAfter}/10</strong></span>
                      )}
                    </div>
                  </div>
                )}

                {/* Core Clinical Documentation */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {note.sessionFocus && (
                    <div>
                      <h4 className="font-medium mb-1">Session Focus</h4>
                      <p className="text-sm text-muted-foreground">{note.sessionFocus}</p>
                    </div>
                  )}
                  {note.symptoms && (
                    <div>
                      <h4 className="font-medium mb-1">Symptoms</h4>
                      <p className="text-sm text-muted-foreground">{note.symptoms}</p>
                    </div>
                  )}
                  {note.shortTermGoals && (
                    <div>
                      <h4 className="font-medium mb-1">Short-term Goals</h4>
                      <p className="text-sm text-muted-foreground">{note.shortTermGoals}</p>
                    </div>
                  )}
                  {note.intervention && (
                    <div>
                      <h4 className="font-medium mb-1">Intervention</h4>
                      <p className="text-sm text-muted-foreground">{note.intervention}</p>
                    </div>
                  )}
                  {note.progress && (
                    <div>
                      <h4 className="font-medium mb-1">Progress</h4>
                      <p className="text-sm text-muted-foreground">{note.progress}</p>
                    </div>
                  )}
                  {note.remarks && (
                    <div>
                      <h4 className="font-medium mb-1">Remarks</h4>
                      <p className="text-sm text-muted-foreground">{note.remarks}</p>
                    </div>
                  )}
                </div>

                {/* Recommendations */}
                {note.recommendations && (
                  <div>
                    <h4 className="font-medium mb-2">Recommendations</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {note.recommendations}
                    </p>
                  </div>
                )}

                {/* Additional Clinical Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {note.goals && (
                    <div>
                      <h4 className="font-medium mb-1">Goals</h4>
                      <p className="text-sm text-muted-foreground">{note.goals}</p>
                    </div>
                  )}
                  {note.interventions && (
                    <div>
                      <h4 className="font-medium mb-1">Interventions</h4>
                      <p className="text-sm text-muted-foreground">{note.interventions}</p>
                    </div>
                  )}
                  {note.assessments && (
                    <div>
                      <h4 className="font-medium mb-1">Assessments</h4>
                      <p className="text-sm text-muted-foreground">{note.assessments}</p>
                    </div>
                  )}
                  {note.homework && (
                    <div>
                      <h4 className="font-medium mb-1">Homework/Action Items</h4>
                      <p className="text-sm text-muted-foreground">{note.homework}</p>
                    </div>
                  )}
                </div>

                {/* Follow-up indicator */}
                {note.followUpNeeded && (
                  <div className="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                    <Target className="h-4 w-4 text-yellow-600" />
                    <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                      Follow-up needed
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add/Edit Session Note Dialog */}
      <Dialog open={isAddNoteOpen} onOpenChange={setIsAddNoteOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingNote ? 'Edit Session Note' : 'Add Session Note'}
            </DialogTitle>
            <DialogDescription>
              Document therapy session details, assessments, and progress notes.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Basic Session Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sessionId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Session</FormLabel>
                      <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a session" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sessions.map((session) => (
                            <SelectItem key={session.id} value={session.id.toString()}>
                              {format(new Date(session.sessionDate), 'MMM dd, yyyy')} - {session.sessionType}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="noteType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Note Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="general">General</SelectItem>
                          <SelectItem value="progress">Progress</SelectItem>
                          <SelectItem value="assessment">Assessment</SelectItem>
                          <SelectItem value="intervention">Intervention</SelectItem>
                          <SelectItem value="homework">Homework</SelectItem>
                          <SelectItem value="crisis">Crisis</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* General Notes */}
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Session Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Document the session details, observations, and key points..."
                        className="min-h-[120px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Organized Clinical Documentation Tabs */}
              <Tabs defaultValue="clinical" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="clinical">Clinical</TabsTrigger>
                  <TabsTrigger value="assessment">Assessment</TabsTrigger>
                  <TabsTrigger value="tracking">Tracking</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                {/* Clinical Documentation Tab */}
                <TabsContent value="clinical" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="sessionFocus"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Session Focus</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Main topics or issues addressed during the session..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="symptoms"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Symptoms</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Observed or reported symptoms..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="shortTermGoals"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Short-term Goals</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Goals worked on during this session..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="intervention"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Intervention</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Therapeutic techniques/interventions used..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="progress"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Progress</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Progress made toward goals..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="remarks"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Remarks</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Additional clinical observations..."
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
                    name="recommendations"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recommendations</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Future treatment recommendations..."
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>

                {/* Assessment Tab */}
                <TabsContent value="assessment" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="goals"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Goals</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Session goals and objectives..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="interventions"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Interventions</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Therapeutic interventions used..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="assessments"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Assessments</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Clinical assessments and observations..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="homework"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Homework/Action Items</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Tasks and assignments for client..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>

                {/* Mood & Progress Tracking Tab */}
                <TabsContent value="tracking" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="moodBefore"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Mood Before Session (1-10)</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              min="1" 
                              max="10" 
                              placeholder="Rate 1-10"
                              {...field}
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="moodAfter"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Mood After Session (1-10)</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              min="1" 
                              max="10" 
                              placeholder="Rate 1-10"
                              {...field}
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>

                {/* Risk & Privacy Settings Tab */}
                <TabsContent value="settings" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="riskLevel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Risk Level</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="confidentialityLevel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confidentiality</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="standard">Standard</SelectItem>
                              <SelectItem value="restricted">Restricted</SelectItem>
                              <SelectItem value="highly_confidential">Highly Confidential</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="flex gap-6">
                    <FormField
                      control={form.control}
                      name="isPrivate"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                          <FormControl>
                            <input
                              type="checkbox"
                              checked={field.value}
                              onChange={field.onChange}
                              className="h-4 w-4"
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">
                            Private Note
                          </FormLabel>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="followUpNeeded"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                          <FormControl>
                            <input
                              type="checkbox"
                              checked={field.value}
                              onChange={field.onChange}
                              className="h-4 w-4"
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">
                            Follow-up Needed
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddNoteOpen(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createSessionNoteMutation.isPending || updateSessionNoteMutation.isPending}
                >
                  {createSessionNoteMutation.isPending || updateSessionNoteMutation.isPending 
                    ? 'Saving...' 
                    : editingNote ? 'Update Note' : 'Create Note'
                  }
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
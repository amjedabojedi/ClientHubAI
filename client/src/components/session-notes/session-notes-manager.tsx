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
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

// Icons
import { Plus, Trash2, Clock, User, Target, Brain, Shield, RefreshCw, Download, Copy, BookOpen, Search, FileText } from "lucide-react";

// Utils
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// Hooks and Data
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Types and Validation
import { z } from "zod";
import { insertSessionNoteSchema } from "@shared/schema";
import { format } from "date-fns";

// Library Types
interface LibraryEntry {
  id: number;
  categoryId: number;
  title: string;
  content: string;
  tags?: string[];
  usageCount?: number;
  category: {
    id: number;
    name: string;
  };
}

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
  assessments?: string;
  homework?: string;
  followUpNeeded?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  confidentialityLevel: 'standard' | 'restricted' | 'highly_confidential';
  isPrivate: boolean;
  
  // AI & content management
  generatedContent?: string;
  draftContent?: string;
  finalContent?: string;
  isDraft: boolean;
  isFinalized: boolean;
  aiEnabled: boolean;
  customAiPrompt?: string;
  aiProcessingStatus?: 'idle' | 'processing' | 'completed' | 'error';
  
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
  aiEnabled: z.boolean().default(false),
  customAiPrompt: z.string().optional(),
});

type SessionNoteFormData = z.infer<typeof sessionNoteFormSchema>;

// Session Notes Manager Component
interface SessionNotesManagerProps {
  clientId: number;
  sessions: Session[];
  preSelectedSessionId?: number;
}

export default function SessionNotesManager({ clientId, sessions, preSelectedSessionId }: SessionNotesManagerProps) {
  // Fetch client data for template generation
  const { data: clientData } = useQuery({
    queryKey: [`/api/clients/${clientId}`],
  });
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<SessionNote | null>(null);
  
  // Risk Assessment State
  const [riskFactors, setRiskFactors] = useState({
    suicidalIdeation: 0,
    selfHarm: 0,
    homicidalIdeation: 0,
    psychosis: 0,
    substanceUse: 0,
    impulsivity: 0,
    aggression: 0,
    traumaSymptoms: 0,
    nonAdherence: 0,
    supportSystem: 0,
  });

  // Load saved templates from localStorage on component mount
  useEffect(() => {
    const stored = localStorage.getItem('aiSessionTemplates');
    if (stored) {
      try {
        const templates = JSON.parse(stored);
        setSavedTemplates(templates);
        // Auto-select the last used template
        const lastUsed = localStorage.getItem('lastUsedTemplate');
        if (lastUsed && templates.find((t: any) => t.id === lastUsed)) {
          setSelectedTemplateId(lastUsed);
          const template = templates.find((t: any) => t.id === lastUsed);
          if (template) setSavedTemplate(template.instructions);
        }
      } catch (e) {
        console.error('Error loading templates:', e);
      }
    }
  }, []);


  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch session notes for the client
  const { data: sessionNotes = [], isLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/session-notes`],
  });

  // Create session note mutation
  const createSessionNoteMutation = useMutation({
    mutationFn: async (data: SessionNoteFormData) => {
      const response = await apiRequest('/api/session-notes', 'POST', data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/session-notes`] });
      setIsAddNoteOpen(false);
      setEditingNote(null);
      resetFormForNewNote();
      toast({ title: "Session note created successfully" });
    },
    onError: () => {
      toast({ title: "Error creating session note", variant: "destructive" });
    },
  });

  // Update session note mutation
  const updateSessionNoteMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<SessionNoteFormData> }) => {
      const response = await apiRequest(`/api/session-notes/${id}`, 'PUT', data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/session-notes`] });
      setIsAddNoteOpen(false);
      setEditingNote(null);
      resetFormForNewNote();
      toast({ title: "Session note updated successfully" });
    },
    onError: () => {
      toast({ title: "Error updating session note", variant: "destructive" });
    },
  });

  // Delete session note mutation
  const deleteSessionNoteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest(`/api/session-notes/${id}`, 'DELETE');
      return response.status === 204 ? { success: true } : await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/session-notes`] });
      toast({ title: "Session note deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error deleting session note", variant: "destructive" });
    },
  });



  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Content copied to clipboard" });
  };

  // Calculate overall risk score
  const calculateOverallRiskScore = () => {
    const totalScore = Object.values(riskFactors).reduce((sum, score) => sum + score, 0);
    const maxPossibleScore = 40; // 10 factors × 4 max score each
    const percentage = (totalScore / maxPossibleScore) * 100;
    
    if (percentage <= 25) return { level: 'Low', color: 'text-green-600', score: totalScore };
    if (percentage <= 50) return { level: 'Moderate', color: 'text-yellow-600', score: totalScore };
    if (percentage <= 75) return { level: 'High', color: 'text-orange-600', score: totalScore };
    return { level: 'Critical', color: 'text-red-600', score: totalScore };
  };

  const updateRiskFactor = (factor: keyof typeof riskFactors, value: number) => {
    setRiskFactors(prev => ({ ...prev, [factor]: value }));
  };

  // Print function for generated content
  const handlePrint = () => {
    if (!generatedContent) return;
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const formValues = form.getValues();
      const currentSession = sessions?.find(s => s.id === formValues.sessionId);
      
      printWindow.document.write(`
        <html>
          <head>
            <title>Session Note - ${clientData?.fullName || 'Client'}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
              .header { border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
              .client-info { margin-bottom: 20px; }
              .content { white-space: pre-wrap; }
              @media print { body { margin: 0; } }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Clinical Session Note</h1>
            </div>
            <div class="client-info">
              <p><strong>Client:</strong> ${clientData?.fullName || 'N/A'}</p>
              <p><strong>Client ID:</strong> ${clientData?.clientId || 'N/A'}</p>
              <p><strong>Session Date:</strong> ${currentSession ? new Date(currentSession.sessionDate).toLocaleDateString() : 'N/A'}</p>
              <p><strong>Session Type:</strong> ${currentSession?.sessionType || 'N/A'}</p>
              <p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
            </div>
            <div class="content">
              ${generatedContent.replace(/\n/g, '<br>')}
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };



  // AI Template generation with custom instructions
  const [isAITemplateOpen, setIsAITemplateOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState('');
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState<string>('');
  const [generatedContent, setGeneratedContent] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<{id: string, name: string, instructions: string}[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateName, setTemplateName] = useState<string>('');

  const generateAITemplateMutation = useMutation({
    mutationFn: async (data: { clientId: number; sessionId?: number; formData: any; customInstructions: string }) => {
      const response = await apiRequest('/api/ai/generate-template', 'POST', data);
      return await response.json();
    },
    onSuccess: (result) => {
      setGeneratedContent(result.generatedContent);
      form.setValue('sessionNotes', result.generatedContent);
      setIsGeneratingAI(false);
      setShowPreview(true);
      
      // Auto-save the generated content as a session note
      const formValues = form.getValues();
      if (formValues.sessionId) {
        const sessionNoteData = {
          sessionId: formValues.sessionId,
          clientId: clientId,
          therapistId: 1, // Default therapist ID - should be from session
          date: new Date().toISOString(),
          generatedContent: result.generatedContent,
          finalContent: result.generatedContent,
          aiEnabled: true,
          customAiPrompt: savedTemplate,
          isDraft: false,
          isFinalized: true,
          sessionFocus: formValues.sessionFocus || '',
          symptoms: formValues.symptoms || '',
          shortTermGoals: formValues.shortTermGoals || '',
          intervention: formValues.intervention || '',
          progress: formValues.progress || '',
          remarks: formValues.remarks || '',
          recommendations: formValues.recommendations || '',
          moodBefore: formValues.moodBefore,
          moodAfter: formValues.moodAfter
        };
        
        createSessionNoteMutation.mutate(sessionNoteData);
      }
      
      toast({ title: "AI content generated and saved! Review in preview or print." });
    },
    onError: (error: any) => {
      console.error('AI template generation error:', error);
      setIsGeneratingAI(false);
      toast({ 
        title: "Failed to generate AI template", 
        description: error.message || "Please check your OpenAI API key configuration",
        variant: "destructive" 
      });
    },
  });

  // Save template for future guidance
  const handleSaveTemplate = () => {
    if (!customInstructions.trim()) {
      toast({ title: "Please provide custom instructions", variant: "destructive" });
      return;
    }
    
    if (!templateName.trim()) {
      toast({ title: "Please enter a template name", variant: "destructive" });
      return;
    }
    
    let updatedTemplates;
    let templateId;
    
    if (selectedTemplateId && savedTemplates.find(t => t.id === selectedTemplateId)) {
      // Editing existing template
      templateId = selectedTemplateId;
      updatedTemplates = savedTemplates.map(template => 
        template.id === selectedTemplateId 
          ? { ...template, name: templateName.trim(), instructions: customInstructions }
          : template
      );
      toast({ title: `Template "${templateName.trim()}" updated successfully!` });
    } else {
      // Creating new template
      templateId = Date.now().toString();
      const newTemplate = {
        id: templateId,
        name: templateName.trim(),
        instructions: customInstructions
      };
      updatedTemplates = [...savedTemplates, newTemplate];
      toast({ title: `Template "${templateName.trim()}" saved! You can reuse it for future session notes.` });
    }
    
    // Update state and localStorage
    setSavedTemplates(updatedTemplates);
    setSavedTemplate(customInstructions);
    setSelectedTemplateId(templateId);
    localStorage.setItem('aiSessionTemplates', JSON.stringify(updatedTemplates));
    localStorage.setItem('lastUsedTemplate', templateId);
    
    setIsAITemplateOpen(false);
    setTemplateName('');
    setCustomInstructions('');
  };

  // Load existing template
  const handleLoadTemplate = (templateId: string) => {
    const template = savedTemplates.find(t => t.id === templateId);
    if (template) {
      setSavedTemplate(template.instructions);
      setSelectedTemplateId(templateId);
      localStorage.setItem('lastUsedTemplate', templateId);
      toast({ title: `Template "${template.name}" loaded!` });
    }
  };

  // Open template for editing
  const handleEditTemplate = () => {
    if (selectedTemplateId) {
      const template = savedTemplates.find(t => t.id === selectedTemplateId);
      if (template) {
        setTemplateName(template.name);
        setCustomInstructions(template.instructions);
        setIsAITemplateOpen(true);
      }
    } else {
      setTemplateName('');
      setCustomInstructions('');
      setIsAITemplateOpen(true);
    }
  };

  // Delete template
  const handleDeleteTemplate = (templateId: string) => {
    const template = savedTemplates.find(t => t.id === templateId);
    if (template && confirm(`Delete template "${template.name}"?`)) {
      const updatedTemplates = savedTemplates.filter(t => t.id !== templateId);
      setSavedTemplates(updatedTemplates);
      localStorage.setItem('aiSessionTemplates', JSON.stringify(updatedTemplates));
      
      if (selectedTemplateId === templateId) {
        setSelectedTemplateId('');
        setSavedTemplate('');
        localStorage.removeItem('lastUsedTemplate');
      }
      
      toast({ title: `Template "${template.name}" deleted` });
    }
  };

  // Generate content using saved template + filled fields
  const handleGenerateContent = () => {
    if (!savedTemplate) {
      toast({ title: "Please create a template first", variant: "destructive" });
      return;
    }

    const formValues = form.getValues();
    const sessionId = formValues.sessionId;

    if (!sessionId) {
      toast({ title: "Please select a session first", variant: "destructive" });
      return;
    }

    // Check if at least some fields are filled
    const hasContent = formValues.sessionFocus || formValues.symptoms || formValues.shortTermGoals || 
                      formValues.intervention || formValues.progress || formValues.assessments || 
                      formValues.homework || formValues.remarks;

    if (!hasContent) {
      toast({ title: "Please fill out some clinical fields first", variant: "destructive" });
      return;
    }

    setIsGeneratingAI(true);
    generateAITemplateMutation.mutate({
      clientId,
      sessionId,
      formData: formValues,
      customInstructions: savedTemplate
    });
  };



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
      aiEnabled: false,
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
      aiEnabled: false,
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
      sessionFocus: note.sessionFocus,
      symptoms: note.symptoms,
      shortTermGoals: note.shortTermGoals,
      intervention: note.intervention,
      progress: note.progress,
      remarks: note.remarks,
      recommendations: note.recommendations,
      moodBefore: note.moodBefore,
      moodAfter: note.moodAfter,
      assessments: note.assessments,
      homework: note.homework,
      followUpNeeded: note.followUpNeeded,
      riskLevel: note.riskLevel,
      confidentialityLevel: note.confidentialityLevel,
      isPrivate: note.isPrivate,
      aiEnabled: note.aiEnabled,
      customAiPrompt: note.customAiPrompt,
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

  // Library Picker Component
  const LibraryPicker = ({ fieldType, onSelect }: {
    fieldType: 'session-focus' | 'symptoms' | 'short-term-goals' | 'interventions' | 'progress';
    onSelect: (content: string) => void;
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Category mapping
    const categoryIds = {
      'session-focus': 1,
      'symptoms': 2,
      'short-term-goals': 3,
      'interventions': 4,
      'progress': 5
    };

    const { data: libraryEntries } = useQuery({
      queryKey: ['/api/library/entries'],
    });

    // Filter entries by category and search
    const filteredEntries = (libraryEntries || []).filter((entry: LibraryEntry) => {
      const matchesCategory = entry.categoryId === categoryIds[fieldType];
      const matchesSearch = !searchQuery || 
        entry.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (entry.tags && entry.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())));
      return matchesCategory && matchesSearch;
    });

    // Mutation for incrementing usage count
    const incrementUsageMutation = useMutation({
      mutationFn: async (entryId: number) => {
        const response = await apiRequest(`/api/library/entries/${entryId}/increment-usage`, 'POST');
        return response.status === 204 ? { success: true } : await response.json();
      },
      onSuccess: () => {
        // Invalidate library entries to refresh usage counts
        queryClient.invalidateQueries({ queryKey: ['/api/library/entries'] });
      },
      onError: (error) => {
        console.error('Failed to increment usage count:', error);
      }
    });

    const handleSelect = (entry: LibraryEntry) => {
      onSelect(entry.content);
      setIsOpen(false);
      
      // Increment usage count
      incrementUsageMutation.mutate(entry.id);
    };

    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2"
          >
            <BookOpen className="h-3 w-3 mr-1" />
            Library
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select from Library - {fieldType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</DialogTitle>
            <DialogDescription>
              Choose from pre-written clinical content to insert into this field
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search library entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <ScrollArea className="h-96">
              <div className="space-y-2">
                {filteredEntries.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No entries found in this category
                  </div>
                ) : (
                  filteredEntries.map((entry: LibraryEntry) => (
                    <div
                      key={entry.id}
                      className="p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                      onClick={() => handleSelect(entry)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-sm">{entry.title}</h4>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                            {entry.content}
                          </p>
                          {entry.tags && entry.tags.length > 0 && (
                            <div className="flex items-center gap-1 mt-2">
                              {entry.tags.slice(0, 3).map((tag, idx) => (
                                <span key={idx} className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 ml-2">
                          Used {entry.usageCount || 0}x
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    );
  };



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
                  {note.assessments && (
                    <div>
                      <h4 className="font-medium mb-1">Clinical Assessments</h4>
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

              {/* AI Template Controls */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium">Please select the template</h3>
                <div className="flex gap-2 flex-wrap">
                  {/* Template Selection */}
                  {savedTemplates.length > 0 && (
                    <select
                      className="text-xs border rounded px-2 py-1"
                      value={selectedTemplateId}
                      onChange={(e) => {
                        if (e.target.value) {
                          handleLoadTemplate(e.target.value);
                        } else {
                          setSelectedTemplateId('');
                          setSavedTemplate('');
                        }
                      }}
                    >
                      <option value="">Select Template...</option>
                      {savedTemplates.map(template => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  )}
                  
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleEditTemplate}
                    className="text-xs"
                  >
                    <Brain className="h-3 w-3 mr-1" />
                    {selectedTemplateId ? 'Edit Template' : 'Create Template'}
                  </Button>
                  
                  {selectedTemplateId && savedTemplates.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteTemplate(selectedTemplateId)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                  
                  {savedTemplate && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={handleGenerateContent}
                      className="text-xs"
                      disabled={generateAITemplateMutation.isPending}
                    >
                      {generateAITemplateMutation.isPending ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                          Generating...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Generate Content
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Organized Clinical Documentation Tabs */}
              <Tabs defaultValue="clinical" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="clinical">Clinical Documentation</TabsTrigger>
                  <TabsTrigger value="risk-assessment">Risk Assessment</TabsTrigger>
                </TabsList>

                {/* Clinical Documentation Tab */}
                <TabsContent value="clinical" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="sessionFocus"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center justify-between">
                            Session Focus
                            <LibraryPicker 
                              fieldType="session-focus" 
                              onSelect={(content) => {
                                const currentValue = field.value || '';
                                const newValue = currentValue ? `${currentValue}\n\n${content}` : content;
                                field.onChange(newValue);
                              }}
                            />
                          </FormLabel>
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
                          <FormLabel className="flex items-center justify-between">
                            Symptoms
                            <LibraryPicker 
                              fieldType="symptoms" 
                              onSelect={(content) => {
                                const currentValue = field.value || '';
                                const newValue = currentValue ? `${currentValue}\n\n${content}` : content;
                                field.onChange(newValue);
                              }}
                            />
                          </FormLabel>
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
                          <FormLabel className="flex items-center justify-between">
                            Short-term Goals
                            <LibraryPicker 
                              fieldType="short-term-goals" 
                              onSelect={(content) => {
                                const currentValue = field.value || '';
                                const newValue = currentValue ? `${currentValue}\n\n${content}` : content;
                                field.onChange(newValue);
                              }}
                            />
                          </FormLabel>
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
                          <FormLabel className="flex items-center justify-between">
                            Intervention
                            <LibraryPicker 
                              fieldType="interventions" 
                              onSelect={(content) => {
                                const currentValue = field.value || '';
                                const newValue = currentValue ? `${currentValue}\n\n${content}` : content;
                                field.onChange(newValue);
                              }}
                            />
                          </FormLabel>
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
                          <FormLabel className="flex items-center justify-between">
                            Progress
                            <LibraryPicker 
                              fieldType="progress" 
                              onSelect={(content) => {
                                const currentValue = field.value || '';
                                const newValue = currentValue ? `${currentValue}\n\n${content}` : content;
                                field.onChange(newValue);
                              }}
                            />
                          </FormLabel>
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


                {/* Risk Assessment Tab */}
                <TabsContent value="risk-assessment" className="space-y-6">
                  {/* Overall Risk Score Display */}
                  <div className="bg-gray-50 p-4 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Overall Risk Assessment</h3>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${calculateOverallRiskScore().color}`}>
                          {calculateOverallRiskScore().level}
                        </div>
                        <div className="text-sm text-gray-600">
                          Score: {calculateOverallRiskScore().score}/40
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Risk Factor Assessment Grid */}
                  <div className="space-y-4">
                    {/* Suicidal Ideation */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">1. Suicidal Ideation</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.suicidalIdeation}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Thoughts of ending one's own life, whether passive or active
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('suicidalIdeation', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.suicidalIdeation === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'None' : score === 1 ? 'Mild' : score === 2 ? 'Moderate' : score === 3 ? 'Severe' : 'Acute'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Self-Harm */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">2. Self-Harm</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.selfHarm}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Any behavior intended to cause harm to oneself without suicidal intent
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('selfHarm', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.selfHarm === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'None' : score === 1 ? 'Urges' : score === 2 ? 'Past' : score === 3 ? 'Current' : 'Severe'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Homicidal Ideation */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">3. Homicidal Ideation</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.homicidalIdeation}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Thoughts about harming or killing others, with or without intent
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('homicidalIdeation', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.homicidalIdeation === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'None' : score === 1 ? 'Passive' : score === 2 ? 'Thoughts' : score === 3 ? 'Intent' : 'Plan'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Psychosis */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">4. Psychosis</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.psychosis}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Presence of hallucinations, delusions, or disorganized thinking
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('psychosis', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.psychosis === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'None' : score === 1 ? 'Past' : score === 2 ? 'Occasional' : score === 3 ? 'Frequent' : 'Acute'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Substance Use */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">5. Substance Use</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.substanceUse}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Use of alcohol or drugs that may impact mental health or judgment
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('substanceUse', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.substanceUse === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'None' : score === 1 ? 'Social' : score === 2 ? 'Frequent' : score === 3 ? 'Dependent' : 'Severe'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Continue with remaining risk factors... */}
                    {/* Impulsivity */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">6. Impulsivity</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.impulsivity}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Difficulty controlling urges or behavior, especially in high-stakes situations
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('impulsivity', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.impulsivity === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'None' : score === 1 ? 'Occasional' : score === 2 ? 'Impacts' : score === 3 ? 'Risk-taking' : 'Dangerous'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Aggression/Violence */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">7. Aggression/Violence</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.aggression}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Verbal or physical aggression toward self, others, or property
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('aggression', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.aggression === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'None' : score === 1 ? 'Verbal' : score === 2 ? 'Threats' : score === 3 ? 'Property' : 'Physical'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Trauma Symptoms */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">8. Trauma Symptoms</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.traumaSymptoms}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Flashbacks, hypervigilance, dissociation, or avoidance related to past trauma
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('traumaSymptoms', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.traumaSymptoms === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'None' : score === 1 ? 'Mild' : score === 2 ? 'Moderate' : score === 3 ? 'Frequent' : 'Severe'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Non-Adherence */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">9. Non-Adherence</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.nonAdherence}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Resistance or avoidance of treatment recommendations
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('nonAdherence', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.nonAdherence === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'Adherent' : score === 1 ? 'Reluctant' : score === 2 ? 'Missed' : score === 3 ? 'Non-compliant' : 'Refuses'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Support System */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">10. Support System</h4>
                        <span className="text-sm font-semibold bg-gray-100 px-2 py-1 rounded">
                          {riskFactors.supportSystem}/4
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Availability of reliable emotional, social, or practical support
                      </p>
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => updateRiskFactor('supportSystem', score)}
                            className={`px-3 py-1 text-xs rounded ${
                              riskFactors.supportSystem === score
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                          >
                            {score === 0 ? 'Strong' : score === 1 ? 'Adequate' : score === 2 ? 'Limited' : score === 3 ? 'Very Limited' : 'None'}
                          </button>
                        ))}
                      </div>
                    </div>
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

      {/* AI Template Dialog */}
      <Dialog open={isAITemplateOpen} onOpenChange={setIsAITemplateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{savedTemplate ? 'Edit Template Instructions' : 'Create AI Template'}</DialogTitle>
            <DialogDescription>
              {savedTemplate 
                ? 'Edit your template instructions. These will guide the AI when generating content after you fill out clinical fields.'
                : 'Create template instructions to guide AI generation. After saving, fill out clinical fields and click "Generate Content" to create session notes.'
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Template Name</label>
              <input
                type="text"
                placeholder="e.g., CBT Session Template, EMDR Progress Notes"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Give your template a descriptive name for easy identification
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Custom Instructions</label>
              <Textarea
                placeholder="Example: Create a session note template focused on cognitive behavioral therapy techniques, including detailed mood tracking, homework assignments, and specific CBT interventions used. Format it professionally for clinical documentation."
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                className="min-h-[120px] mt-2"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Provide specific instructions about the format, focus areas, therapy approach, or any special requirements for your session note template.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsAITemplateOpen(false);
                setCustomInstructions('');
                setTemplateName('');
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSaveTemplate}
              disabled={!customInstructions.trim() || !templateName.trim()}
            >
              <Brain className="h-4 w-4 mr-2" />
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog for Generated Content */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>AI Generated Session Note - Preview</DialogTitle>
            <DialogDescription>
              Review the generated content. You can save it to session notes, print it, or copy to clipboard.
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh] p-4 border rounded-md">
            <div className="whitespace-pre-wrap text-sm">
              {generatedContent}
            </div>
          </ScrollArea>

          <DialogFooter className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => copyToClipboard(generatedContent)}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handlePrint}
            >
              <Download className="h-4 w-4 mr-2" />
              Print
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPreview(false)}
            >
              Close Preview
            </Button>
            <Button
              type="button"
              onClick={() => {
                setShowPreview(false);
                toast({ title: "Session note already saved! You can view it in the Session Notes tab." });
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
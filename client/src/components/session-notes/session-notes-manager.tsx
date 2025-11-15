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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Rich Text Editor
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

// Icons
import { Plus, Trash2, Clock, User, Target, Brain, Shield, RefreshCw, Download, Copy, BookOpen, Search, FileText, Edit, CheckCircle, Eye, Calendar, HelpCircle, ChevronDown } from "lucide-react";

// Voice Recording
import { FloatingVoiceButton } from "./floating-voice-button";
import { TranscriptionReviewDialog } from "./transcription-review-dialog";

// Utils
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useConnectedEntries } from "@/hooks/use-connected-entries";

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

// Utility function to parse UTC date strings without timezone shift
const parseSessionDate = (dateString: string | null | undefined): Date => {
  // Handle null, undefined, or empty string
  if (!dateString) {
    return new Date();
  }
  // If date is already in YYYY-MM-DD format, add time to avoid timezone issues
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(dateString + 'T12:00:00');
  }
  // Handle ISO strings properly - keep the original time but ensure consistent parsing
  if (dateString.includes('T')) {
    return new Date(dateString);
  }
  // Fallback for other formats
  return new Date(dateString);
};

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

// Session Note Types - matching database schema
interface SessionNote {
  id: number;
  sessionId: number;
  clientId: number;
  therapistId: number;
  date: string;
  
  // Core clinical documentation fields
  sessionFocus?: string | null;
  symptoms?: string | null;
  shortTermGoals?: string | null;
  intervention?: string | null;
  progress?: string | null;
  remarks?: string | null;
  recommendations?: string | null;
  
  // Rating & outcome fields
  clientRating?: number | null;
  therapistRating?: number | null;
  progressTowardGoals?: number | null;
  moodBefore?: number | null;
  moodAfter?: number | null;
  
  // Risk Assessment fields (0-4 scale)
  riskSuicidalIdeation?: number | null;
  riskSelfHarm?: number | null;
  riskHomicidalIdeation?: number | null;
  riskPsychosis?: number | null;
  riskSubstanceUse?: number | null;
  riskImpulsivity?: number | null;
  riskAggression?: number | null;
  riskTraumaSymptoms?: number | null;
  riskNonAdherence?: number | null;
  riskSupportSystem?: number | null;
  
  // AI & content management
  generatedContent?: string | null;
  draftContent?: string | null;
  finalContent?: string | null;
  isDraft: boolean;
  isFinalized: boolean;
  aiEnabled: boolean;
  customAiPrompt?: string | null;
  aiProcessingStatus?: string | null;
  
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
    room?: { roomName: string } | null;
  };
}

interface Session {
  id: number;
  clientId: number;
  sessionDate: string;
  sessionType: string;
  status: string;
  room?: { roomName: string } | null;
}

// Rich Text Editor Configuration
const quillModules = {
  toolbar: [
    [{ 'header': [1, 2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    ['clean']
  ],
};

const quillFormats = [
  'header',
  'bold', 'italic', 'underline',
  'list', 'bullet'
];

// Form Schema - content field removed as it doesn't exist in DB
const sessionNoteFormSchema = insertSessionNoteSchema.extend({
  aiEnabled: z.boolean().default(false),
  customAiPrompt: z.string().optional(),
  generatedContent: z.string().optional(),
});

type SessionNoteFormData = z.infer<typeof sessionNoteFormSchema>;

// Session Notes Manager Component
interface SessionNotesManagerProps {
  clientId: number;
  sessions: Session[];
  preSelectedSessionId?: number | null;
  preSelectedNoteId?: number | null;
  onSessionChange?: (sessionId: number | null) => void;
  onNoteChange?: (noteId: number | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function SessionNotesManager({ clientId, sessions, preSelectedSessionId, preSelectedNoteId, onSessionChange, onNoteChange, open, onOpenChange }: SessionNotesManagerProps) {
  // Fetch client data for template generation
  const { data: clientData } = useQuery<{ id: number; fullName: string }>({
    queryKey: [`/api/clients/${clientId}`],
  });
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [internalIsAddNoteOpen, setInternalIsAddNoteOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<SessionNote | null>(null);
  const [isFromSessionClick, setIsFromSessionClick] = useState(false); // Track if came from session click
  
  // Voice transcription review state
  const [pendingTranscription, setPendingTranscription] = useState<{
    rawTranscription: string;
    mappedFields: {
      sessionFocus?: string;
      symptoms?: string;
      shortTermGoals?: string;
      intervention?: string;
      progress?: string;
      remarks?: string;
      recommendations?: string;
    };
  } | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  
  // Use external open state if provided, otherwise use internal state
  const isAddNoteOpen = open !== undefined ? open : internalIsAddNoteOpen;
  const setIsAddNoteOpen = onOpenChange || setInternalIsAddNoteOpen;
  
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

  // Track selected library entries per field for relationship filtering
  const [selectedLibraryEntries, setSelectedLibraryEntries] = useState<{
    'session-focus': number[];
    'symptoms': number[];
    'short-term-goals': number[];
    'interventions': number[];
    'progress': number[];
  }>({
    'session-focus': [],
    'symptoms': [],
    'short-term-goals': [],
    'interventions': [],
    'progress': []
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
        // Template loading failed - ignore silently
      }
    }
  }, []);


  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch session notes for the client
  const { data: sessionNotes = [], isLoading } = useQuery<SessionNote[]>({
    queryKey: [`/api/clients/${clientId}/session-notes`],
  });

  // Create session note mutation
  const createSessionNoteMutation = useMutation({
    mutationFn: async (data: SessionNoteFormData) => {
      const response = await apiRequest('/api/session-notes', 'POST', data);
      if (!response.ok) {
        const errorData = await response.json();
        console.error('[SESSION NOTE] Creation failed:', errorData);
        throw new Error(JSON.stringify(errorData));
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/session-notes`] });
      setIsAddNoteOpen(false);
      setEditingNote(null);
      resetFormForNewNote();
      toast({ title: "Session note created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error creating session note", description: error.message, variant: "destructive" });
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
            <title>Session Note - ${(clientData as any)?.fullName || 'Client'}</title>
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
              <p><strong>Client:</strong> ${(clientData as any)?.fullName || 'N/A'}</p>
              <p><strong>Client ID:</strong> ${(clientData as any)?.clientId || 'N/A'}</p>
              <p><strong>Session Date:</strong> ${currentSession ? (() => {
                const sessionDate = new Date(currentSession.sessionDate + 'T12:00:00');
                return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-${String(sessionDate.getDate()).padStart(2, '0')}`;
              })() : 'N/A'}</p>
              <p><strong>Session Type:</strong> ${currentSession?.sessionType || 'N/A'}</p>
              <p><strong>Generated:</strong> ${format(new Date(), 'MMM dd, yyyy')}</p>
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

  // Convert plain text to HTML for rich text editor
  const convertTextToHTML = (text: string): string => {
    if (!text) return '';
    
    // Common section headers in AI-generated notes
    const sectionHeaders = [
      'CLIENT INFORMATION',
      'SESSION INFORMATION', 
      'SESSION FOCUS',
      'SYMPTOMS',
      'SHORT-TERM GOALS',
      'INTERVENTION',
      'PROGRESS',
      'REMARKS',
      'RECOMMENDATIONS',
      'CLINICAL NOTES',
      'ASSESSMENT',
      'TREATMENT PLAN',
      'NEXT STEPS',
      'HOMEWORK',
      'FOLLOW-UP'
    ];
    
    // First, add line breaks before section headers if they're missing
    let formatted = text;
    sectionHeaders.forEach(header => {
      const regex = new RegExp(`(${header})`, 'g');
      formatted = formatted.replace(regex, '\n\n$1\n');
    });
    
    // Split into lines now
    const lines = formatted.split('\n');
    let html = '';
    let inList = false;
    let currentParagraph = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Empty line - end current paragraph
      if (!line) {
        if (currentParagraph) {
          html += `<p>${currentParagraph}</p>`;
          currentParagraph = '';
        }
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        continue;
      }
      
      // Check if this is a section header
      const isHeader = sectionHeaders.some(h => line.includes(h));
      if (isHeader) {
        if (currentParagraph) {
          html += `<p>${currentParagraph}</p>`;
          currentParagraph = '';
        }
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        // Add separator before header (except for the first one)
        if (html) {
          html += '<hr style="border: none; border-top: 2px solid #e5e7eb; margin: 20px 0;">';
        }
        html += `<h2 style="font-weight: bold; font-size: 1.25em; color: #1f2937; margin-top: 10px; margin-bottom: 10px;">${line}</h2>`;
        continue;
      }
      
      // Bullet point (starts with - or * or •)
      if (line.match(/^[-*•]\s+/)) {
        if (currentParagraph) {
          html += `<p>${currentParagraph}</p>`;
          currentParagraph = '';
        }
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        const content = line.replace(/^[-*•]\s+/, '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html += `<li>${content}</li>`;
        continue;
      }
      
      // End list if we're in one
      if (inList && !line.match(/^[-*•]\s+/)) {
        html += '</ul>';
        inList = false;
      }
      
      // Regular line - add to current paragraph
      const contentFormatted = line
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/Name:/g, '<strong>Name:</strong>')
        .replace(/Client ID:/g, '<strong>Client ID:</strong>')
        .replace(/Age:/g, '<strong>Age:</strong>')
        .replace(/Gender:/g, '<strong>Gender:</strong>')
        .replace(/Date:/g, '<strong>Date:</strong>')
        .replace(/Type:/g, '<strong>Type:</strong>')
        .replace(/Duration:/g, '<strong>Duration:</strong>')
        .replace(/Treatment Stage:/g, '<strong>Treatment Stage:</strong>');
        
      if (currentParagraph) {
        currentParagraph += '<br>' + contentFormatted;
      } else {
        currentParagraph = contentFormatted;
      }
    }
    
    // Close any remaining open elements
    if (currentParagraph) {
      html += `<p>${currentParagraph}</p>`;
    }
    if (inList) {
      html += '</ul>';
    }
    
    return html || '<p>No content generated</p>';
  };

  const generateAITemplateMutation = useMutation({
    mutationFn: async (data: { clientId: number; sessionId?: number; formData: any; customInstructions: string }) => {
      const response = await apiRequest('/api/ai/generate-template', 'POST', data);
      return await response.json();
    },
    onSuccess: (result) => {
      setGeneratedContent(result.generatedContent);
      setIsGeneratingAI(false);
      setShowPreview(true);
      
      // Auto-populate generated content into the generatedContent field with HTML formatting
      if (result.generatedContent) {
        const htmlContent = convertTextToHTML(result.generatedContent);
        form.setValue('generatedContent', htmlContent);
        // Force a re-render of the Quill editor
        setTimeout(() => {
          form.trigger('generatedContent');
        }, 100);
      }
      
      toast({ title: "AI content generated! Scroll down to see formatted content in the editor." });
    },
    onError: (error: any) => {

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
                      formValues.intervention || formValues.progress || formValues.remarks;

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

  // Handle applying transcription after review
  const handleApplyTranscription = (selectedFields: {
    [key: string]: { value: string; mergeMode: 'append' | 'replace' };
  }) => {
    // Get fresh current values from form to avoid stale data
    const currentFormValues = form.getValues();
    
    Object.keys(selectedFields).forEach((fieldKey) => {
      const { value: newValue, mergeMode } = selectedFields[fieldKey];
      
      // Skip empty new values
      const newValueTrimmed = newValue?.trim();
      if (!newValueTrimmed) return;
      
      // Get current field value (fresh from form)
      const currentValue = currentFormValues[fieldKey as keyof typeof currentFormValues] as string | null | undefined;
      
      // Check if current has actual content (not just whitespace)
      const hasCurrentContent = currentValue && currentValue.trim().length > 0;
      
      // Determine final value based on merge mode and current content
      let finalValue: string;
      
      if (mergeMode === 'append' && hasCurrentContent) {
        // Append: preserve original formatting of current value, add separator, then new content
        finalValue = `${currentValue}\n\n${newValueTrimmed}`;
      } else {
        // Replace: either explicitly requested OR current field is empty/whitespace
        finalValue = newValueTrimmed;
      }
      
      // Update form field
      form.setValue(fieldKey as any, finalValue, { 
        shouldDirty: true, 
        shouldTouch: true 
      });
    });
    
    // Store raw transcript for audit trail
    if (pendingTranscription?.rawTranscription) {
      form.setValue('voiceTranscription', pendingTranscription.rawTranscription);
    }
    
    // Clear pending state
    setPendingTranscription(null);
    
    // Show success message
    const fieldCount = Object.keys(selectedFields).length;
    toast({
      title: "Transcription applied!",
      description: `${fieldCount} field${fieldCount !== 1 ? 's' : ''} updated. Review and save your changes.`
    });
  };
  
  const handleDiscardTranscription = () => {
    setPendingTranscription(null);
    toast({
      title: "Transcription discarded",
      description: "No changes were made to your session note"
    });
  };



  // Get authenticated user
  const { user } = useAuth();

  // Form setup
  const form = useForm<SessionNoteFormData>({
    resolver: zodResolver(sessionNoteFormSchema),
    defaultValues: {
      clientId,
      therapistId: user?.id || 1,
      date: new Date(),
      sessionId: undefined,
      aiEnabled: false,
    },
  });

  // Auto-populate session when pre-selected (moved after form setup)
  useEffect(() => {
    if (preSelectedSessionId && preSelectedSessionId !== selectedSession) {
      setSelectedSession(preSelectedSessionId);
      setIsFromSessionClick(true); // Mark that we came from a session click
      // Automatically open the add note dialog when session is pre-selected
      setIsAddNoteOpen(true);
      // Pre-populate the form with the selected session
      form.setValue('sessionId', preSelectedSessionId);
      // Clear the pre-selection after processing
      if (onSessionChange) {
        onSessionChange(null);
      }
    }
  }, [preSelectedSessionId, selectedSession, onSessionChange, form]);

  // Auto-edit note when pre-selected note ID is provided
  useEffect(() => {
    if (preSelectedNoteId && sessionNotes && sessionNotes.length > 0) {
      const noteToEdit = sessionNotes.find((note: SessionNote) => note.id === preSelectedNoteId);
      if (noteToEdit) {
        resetFormForEdit(noteToEdit);
        setEditingNote(noteToEdit);
        setIsFromSessionClick(true);
        setIsAddNoteOpen(true);
        // Clear the pre-selection after processing
        if (onNoteChange) {
          onNoteChange(null);
        }
      }
    }
  }, [preSelectedNoteId, sessionNotes, onNoteChange]);

  // Reset form for new note
  const resetFormForNewNote = () => {
    form.reset({
      sessionId: preSelectedSessionId || undefined,
      clientId,
      therapistId: user?.id || 1,
      date: new Date(),
      aiEnabled: false,
    });
    // Reset risk factors to 0
    setRiskFactors({
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
  };

  // Reset form for editing
  const resetFormForEdit = (note: SessionNote) => {
    form.reset({
      sessionId: note.sessionId,
      clientId: note.clientId,
      therapistId: note.therapistId,
      date: new Date(note.createdAt),
      sessionFocus: note.sessionFocus || '',
      symptoms: note.symptoms || '',
      shortTermGoals: note.shortTermGoals || '',
      intervention: note.intervention || '',
      progress: note.progress || '',
      remarks: note.remarks || '',
      recommendations: note.recommendations || '',
      generatedContent: note.generatedContent || '',
      moodBefore: note.moodBefore || undefined,
      moodAfter: note.moodAfter || undefined,
      aiEnabled: note.aiEnabled,
      customAiPrompt: note.customAiPrompt || '',
    });
    // Load risk factors from note
    setRiskFactors({
      suicidalIdeation: note.riskSuicidalIdeation || 0,
      selfHarm: note.riskSelfHarm || 0,
      homicidalIdeation: note.riskHomicidalIdeation || 0,
      psychosis: note.riskPsychosis || 0,
      substanceUse: note.riskSubstanceUse || 0,
      impulsivity: note.riskImpulsivity || 0,
      aggression: note.riskAggression || 0,
      traumaSymptoms: note.riskTraumaSymptoms || 0,
      nonAdherence: note.riskNonAdherence || 0,
      supportSystem: note.riskSupportSystem || 0,
    });
  };

  // Handle form submission
  const onSubmit = (data: SessionNoteFormData) => {
    // Ensure required fields are set
    const submissionData = {
      ...data,
      date: data.date || new Date(),
      therapistId: user?.id || data.therapistId, // Always use authenticated user ID
      // Include risk factors
      riskSuicidalIdeation: riskFactors.suicidalIdeation,
      riskSelfHarm: riskFactors.selfHarm,
      riskHomicidalIdeation: riskFactors.homicidalIdeation,
      riskPsychosis: riskFactors.psychosis,
      riskSubstanceUse: riskFactors.substanceUse,
      riskImpulsivity: riskFactors.impulsivity,
      riskAggression: riskFactors.aggression,
      riskTraumaSymptoms: riskFactors.traumaSymptoms,
      riskNonAdherence: riskFactors.nonAdherence,
      riskSupportSystem: riskFactors.supportSystem,
    };
    
    if (editingNote) {
      updateSessionNoteMutation.mutate({ id: editingNote.id, data: submissionData });
    } else {
      createSessionNoteMutation.mutate(submissionData);
    }
  };

  // Handle add note
  const handleAddNote = () => {
    resetFormForNewNote();
    setEditingNote(null);
    setIsFromSessionClick(false); // Reset when manually adding note
    
    // Auto-populate session if one is selected
    if (selectedSession) {
      form.setValue('sessionId', selectedSession);
    }
    
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

  // Handle finalize note
  // State for finalization modal
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [noteToFinalize, setNoteToFinalize] = useState<number | null>(null);

  const handleFinalizeNote = (id: number) => {
    setNoteToFinalize(id);
    setFinalizeModalOpen(true);
  };

  const confirmFinalize = async () => {
    if (!noteToFinalize) return;
    
    try {
      await apiRequest(`/api/session-notes/${noteToFinalize}/finalize`, 'POST');
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/session-notes`] });
      toast({ title: "Session note finalized successfully" });
      setFinalizeModalOpen(false);
      setNoteToFinalize(null);
      // Close the main editor dialog after finalization
      setIsAddNoteOpen(false);
      setEditingNote(null);
    } catch (error) {
      toast({ 
        title: "Error finalizing note", 
        description: error instanceof Error ? error.message : "Failed to finalize note",
        variant: "destructive" 
      });
    }
  };

  // Handle PDF preview (same format as download)
  const handlePreviewPDF = async (note: SessionNote) => {
    try {
      const response = await fetch(`/api/session-notes/${note.id}/pdf`);
      
      if (!response.ok) throw new Error('Failed to generate PDF');
      
      const html = await response.text();
      
      // Open in new window with print styles active
      const previewWindow = window.open('', '_blank');
      if (previewWindow) {
        previewWindow.document.write(html);
        previewWindow.document.close();
      }
    } catch (error) {
      toast({ 
        title: "Error generating PDF preview", 
        description: error instanceof Error ? error.message : "Failed to generate PDF",
        variant: "destructive" 
      });
    }
  };

  // Handle PDF download (opens print dialog to save as PDF)
  const handleDownloadPDF = async (note: SessionNote) => {
    try {
      const response = await fetch(`/api/session-notes/${note.id}/pdf`);
      
      if (!response.ok) throw new Error('Failed to generate PDF');
      
      const html = await response.text();
      
      // Create a new window with the HTML content and auto-trigger print
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        
        // Wait for content to load, then trigger print
        printWindow.onload = () => {
          printWindow.print();
        };
      }
    } catch (error) {
      toast({ 
        title: "Error downloading PDF", 
        description: error instanceof Error ? error.message : "Failed to download PDF",
        variant: "destructive" 
      });
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
    onSelect: (content: string, entryId: number) => void;
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showConnectedOnly, setShowConnectedOnly] = useState(false);

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

    // Define which fields should be used as filter sources for each field type
    // E.g., when opening Goals, use only Symptoms; when opening Interventions, use Symptoms and Goals
    const fieldRelationships: Record<typeof fieldType, (typeof fieldType)[]> = {
      'session-focus': [], // No filtering for session focus
      'symptoms': [], // No filtering for symptoms (it's the source)
      'short-term-goals': ['symptoms'], // Goals filtered by symptoms
      'interventions': ['symptoms', 'short-term-goals'], // Interventions filtered by symptoms and goals
      'progress': ['symptoms', 'short-term-goals', 'interventions'] // Progress filtered by symptoms, goals, and interventions
    };

    // Get selected entry IDs only from relevant related fields
    const relevantFields = fieldRelationships[fieldType];
    const previouslySelectedIds = relevantFields.flatMap(field => selectedLibraryEntries[field]);

    // Fetch connected entries using the custom hook
    const { data: connectedEntries = [], isLoading: isLoadingConnections } = useConnectedEntries(
      showConnectedOnly ? previouslySelectedIds : []
    );

    // Extract connected entry IDs and filter by current category
    const connectedEntryIds = connectedEntries.map((entry: any) => entry.id);
    const connectedEntriesInCategory = connectedEntries.filter(
      (entry: any) => entry.categoryId === categoryIds[fieldType]
    );
    const connectedEntryIdsInCategory = connectedEntriesInCategory.map((entry: any) => entry.id);

    // Filter entries by category, search, and connections
    const filteredEntries = Array.isArray(libraryEntries) ? libraryEntries.filter((entry: LibraryEntry) => {
      const matchesCategory = entry.categoryId === categoryIds[fieldType];
      const matchesSearch = !searchQuery || 
        entry.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (entry.tags && entry.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())));
      
      // If "Show connected only" is enabled, filter by connections IN THIS CATEGORY
      const matchesConnection = !showConnectedOnly || 
        (connectedEntryIdsInCategory.length > 0 && connectedEntryIdsInCategory.includes(entry.id));
      
      return matchesCategory && matchesSearch && matchesConnection;
    }) : [];

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

      }
    });

    const handleSelect = (entry: LibraryEntry) => {
      onSelect(entry.content, entry.id);
      setIsOpen(false);
      
      // Increment usage count
      incrementUsageMutation.mutate(entry.id);
      
      // Track this selection
      setSelectedLibraryEntries(prev => ({
        ...prev,
        [fieldType]: [...prev[fieldType], entry.id]
      }));
    };

    // Get count of previously selected entries from other fields
    const previousSelectionsCount = Object.entries(selectedLibraryEntries)
      .filter(([key]) => key !== fieldType)
      .reduce((sum, [, ids]) => sum + ids.length, 0);
    
    const hasConnections = connectedEntryIdsInCategory.length > 0;
    const showingFiltered = showConnectedOnly && hasConnections;

    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            data-testid={`button-library-picker-${fieldType}`}
          >
            <BookOpen className="h-3 w-3 mr-1" />
            Library
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select from Library - {fieldType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</DialogTitle>
            <DialogDescription>
              Choose from pre-written clinical content to insert into this field
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Search Box */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search library entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid={`input-search-library-${fieldType}`}
              />
            </div>
            
            {/* Connected Entries Filter Toggle */}
            {previousSelectionsCount > 0 && (
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={showConnectedOnly}
                      onCheckedChange={setShowConnectedOnly}
                      data-testid={`toggle-connected-only-${fieldType}`}
                    />
                    <Label htmlFor="connected-filter" className="font-medium text-sm cursor-pointer" onClick={() => setShowConnectedOnly(!showConnectedOnly)}>
                      Show connected entries only
                    </Label>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 ml-11">
                    {showConnectedOnly 
                      ? hasConnections
                        ? `Showing ${connectedEntryIdsInCategory.length} connected ${connectedEntryIdsInCategory.length === 1 ? 'entry' : 'entries'} (from ${connectedEntries.length} total connections)`
                        : 'No connections found in this category.'
                      : `Filter by entries connected to your ${previousSelectionsCount} previous selection${previousSelectionsCount > 1 ? 's' : ''}`
                    }
                  </p>
                </div>
              </div>
            )}

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
    <div>
      {/* SessionNotesManager now only provides dialogs - card list removed */}
      {/* All session note management is integrated into the Session History tab */}
      
      {/* Add/Edit Session Note Dialog */}
      <Dialog open={isAddNoteOpen} onOpenChange={setIsAddNoteOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              {editingNote ? 'Edit Session Note' : 'Add Session Note'}
            </DialogTitle>
            {(() => {
              // Get session ID from either editing note or form watch
              const sessionId = editingNote?.sessionId || form.watch('sessionId');
              const session = sessions.find(s => s.id === sessionId);
              if (session) {
                return (
                  <div className="mt-2 p-3 bg-blue-50 rounded-md border border-blue-100">
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-blue-600" />
                      <span className="font-medium text-blue-900">
                        Session: {format(parseSessionDate(session.sessionDate), 'MMMM dd, yyyy')} - {session.sessionType}
                      </span>
                    </div>
                    {clientData && (
                      <div className="text-xs text-blue-700 mt-1">
                        Client: {clientData.fullName}
                      </div>
                    )}
                  </div>
                );
              }
              return <DialogDescription>Document therapy session details, assessments, and progress notes.</DialogDescription>;
            })()}
            
            {/* Workflow Instructions */}
            <Collapsible defaultOpen={true} className="mt-3">
              <Card className="border-blue-200 bg-blue-50">
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="cursor-pointer hover:bg-blue-100 transition-colors rounded-t-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HelpCircle className="w-5 h-5 text-blue-600" />
                        <CardTitle className="text-base">{editingNote ? 'Session Note Editing Guide' : 'Session Note Creation Guide'}</CardTitle>
                      </div>
                      <ChevronDown className="w-5 h-5 text-blue-600" />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-3 pt-0">
                    {editingNote ? (
                      <>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                          <div>
                            <p className="font-medium text-sm">Edit Content</p>
                            <p className="text-xs text-gray-600">Edit any field directly to add, remove, or modify content. Use the 📚 library button to insert pre-written clinical content if needed.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                          <div>
                            <p className="font-medium text-sm">Update Assessments</p>
                            <p className="text-xs text-gray-600">Update Clinical Documentation and Risk Assessment fields (10 factors) as needed to reflect current session.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                          <div>
                            <p className="font-medium text-sm">Save Your Changes</p>
                            <p className="text-xs text-gray-600">Click <strong>Save Draft</strong> to continue editing later, or <strong>Save & Finalize</strong> to lock permanently with date stamp (no more edits). Once finalized, preview as PDF through session history.</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                          <div>
                            <p className="font-medium text-sm">Select Template</p>
                            <p className="text-xs text-gray-600">Select or create a template (required for AI generation, or skip if entering manually)</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                          <div>
                            <p className="font-medium text-sm">Fill Clinical Fields</p>
                            <p className="text-xs text-gray-600">Fill in clinical fields (Session Focus, Symptoms, Goals, etc.) OR use 📚 button to insert from library</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                          <div>
                            <p className="font-medium text-sm">Generate Content (Optional)</p>
                            <p className="text-xs text-gray-600">Click <strong>Generate Content</strong> → AI uses your filled data + template to create enhanced professional note</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</div>
                          <div>
                            <p className="font-medium text-sm">Review & Complete Assessment</p>
                            <p className="text-xs text-gray-600">Review AI-generated content (accept or edit as needed), then complete Risk Assessment (10 factors)</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">5</div>
                          <div>
                            <p className="font-medium text-sm">Save as Draft</p>
                            <p className="text-xs text-gray-600">Click <strong>Create Draft</strong> → saves to database as draft (unlocked, editable anytime)</p>
                          </div>
                        </div>
                      </>
                    )}
                    <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                      <p className="text-xs text-blue-900">
                        <strong>💡 Pro Tips:</strong> Session notes provide professional clinical documentation of therapy sessions, track client progress, assess risk factors, and maintain HIPAA-compliant records required for insurance and legal purposes.
                      </p>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Basic Session Information - Only show dropdown if NOT pre-selected */}
              {!isFromSessionClick && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="sessionId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Session</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(parseInt(value))} 
                          value={field.value?.toString()}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a session" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {sessions.map((session) => (
                              <SelectItem key={session.id} value={session.id.toString()}>
                                {format(parseSessionDate(session.sessionDate), 'MMM dd, yyyy')} - {session.sessionType}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

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

              {/* Voice Transcription Display (if exists) */}
              {editingNote?.voiceTranscription && (
                <Collapsible className="mb-4">
                  <Card className="border-purple-200 bg-purple-50">
                    <CollapsibleTrigger className="w-full">
                      <CardHeader className="cursor-pointer hover:bg-purple-100 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Mic className="w-5 h-5 text-purple-600" />
                            <CardTitle className="text-base">Voice Transcription (Original Recording)</CardTitle>
                          </div>
                          <ChevronDown className="w-5 h-5 text-purple-600" />
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="pt-0">
                        <div className="p-3 bg-white rounded border border-purple-200">
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">
                            {editingNote.voiceTranscription}
                          </p>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          This is the raw text from your voice recording before AI field mapping
                        </p>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              )}

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
                              onSelect={(content, entryId) => {
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
                              value={field.value || ''}
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
                              onSelect={(content, entryId) => {
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
                              value={field.value || ''}
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
                              onSelect={(content, entryId) => {
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
                              value={field.value || ''}
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
                              onSelect={(content, entryId) => {
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
                              value={field.value || ''}
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
                              onSelect={(content, entryId) => {
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
                              value={field.value || ''}
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
                              value={field.value || ''}
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
                            value={field.value || ''}
                            rows={3}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* AI Generated Content - Rich Text Editor */}
                  <FormField
                    control={form.control}
                    name="generatedContent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-blue-600" />
                          AI Generated Session Note (Rich Text Editor)
                        </FormLabel>
                        <FormControl>
                          <div className="bg-white dark:bg-gray-950 rounded-md border min-h-[300px]">
                            <ReactQuill
                              key={editingNote?.id || 'new-note'}
                              theme="snow"
                              value={field.value || ''}
                              onChange={(content) => {
                                field.onChange(content);
                              }}
                              onBlur={field.onBlur}
                              modules={quillModules}
                              formats={quillFormats}
                              placeholder="AI-generated content will appear here after you click 'Generate Content'. You can edit it with rich text formatting..."
                              style={{ minHeight: '250px' }}
                            />
                          </div>
                        </FormControl>
                        <p className="text-xs text-muted-foreground mt-1">
                          Edit the AI-generated session note with formatting. This will be saved when you click "Create Note" or "Update Note".
                        </p>
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

              <DialogFooter className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddNoteOpen(false)}
                >
                  Cancel
                </Button>
                <div className="flex gap-2">
                  <Button 
                    type="submit" 
                    variant="outline"
                    disabled={createSessionNoteMutation.isPending || updateSessionNoteMutation.isPending}
                  >
                    {createSessionNoteMutation.isPending || updateSessionNoteMutation.isPending 
                      ? 'Saving...' 
                      : editingNote ? 'Save Draft' : 'Create Draft'
                    }
                  </Button>
                  {editingNote && (
                    <Button 
                      type="button"
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => {
                        // First save the form data
                        form.handleSubmit((data) => {
                          const submissionData = {
                            ...data,
                            date: data.date || new Date(),
                            therapistId: user?.id || data.therapistId,
                          };
                          // Update the note first
                          updateSessionNoteMutation.mutate(
                            { id: editingNote.id, data: submissionData },
                            {
                              onSuccess: () => {
                                // Then finalize it
                                handleFinalizeNote(editingNote.id);
                              }
                            }
                          );
                        })();
                      }}
                      disabled={createSessionNoteMutation.isPending || updateSessionNoteMutation.isPending}
                      data-testid="button-save-and-finalize"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Save & Finalize
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </form>
          </Form>

          {/* Floating Voice Recording Button - Inside Dialog (for both new and existing notes) */}
          {(() => {
            const sessionId = form.getValues('sessionId');
            const session = sessions.find(s => s.id === sessionId);
            const sessionDateFormatted = session 
              ? format(parseSessionDate(session.sessionDate), 'MMMM dd, yyyy') + ' - ' + session.sessionType
              : 'Session date not available';
            
            return (
              <FloatingVoiceButton
                sessionNoteId={editingNote?.id || null}
                clientName={clientData?.fullName || 'Client'}
                sessionDate={sessionDateFormatted}
                onTranscriptionComplete={(data) => {
                  setPendingTranscription(data);
                  setShowReviewDialog(true);
                }}
              />
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* AI Template Dialog */}
      <Dialog open={isAITemplateOpen} onOpenChange={setIsAITemplateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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

      {/* Finalization Confirmation Dialog */}
      <Dialog open={finalizeModalOpen} onOpenChange={setFinalizeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalize Session Note</DialogTitle>
            <DialogDescription>
              Are you sure you want to finalize this session note?
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium mb-2">
                ⚠️ This action is irreversible
              </p>
              <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1 list-disc list-inside">
                <li>The note will be locked and cannot be edited</li>
                <li>Finalization timestamp will be recorded</li>
                <li>Your digital signature will be applied to the PDF</li>
              </ul>
            </div>

            {(!user?.title || !user?.signatureImage) && (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">
                  📝 Profile Information
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {!user?.title && !user?.signatureImage && "Your professional title and signature image are not set. "}
                  {!user?.title && user?.signatureImage && "Your professional title is not set. "}
                  {user?.title && !user?.signatureImage && "Your signature image is not set. "}
                  The PDF will include your name{user?.title ? " and title" : ""} in the signature section.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFinalizeModalOpen(false);
                setNoteToFinalize(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmFinalize}
              data-testid="button-confirm-finalize"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Finalize Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voice Transcription Review Dialog */}
      {showReviewDialog && (
        <TranscriptionReviewDialog
          open={showReviewDialog}
          onOpenChange={setShowReviewDialog}
          transcriptionData={pendingTranscription}
          currentFieldValues={{
            sessionFocus: form.getValues('sessionFocus') || undefined,
            symptoms: form.getValues('symptoms') || undefined,
            shortTermGoals: form.getValues('shortTermGoals') || undefined,
            intervention: form.getValues('intervention') || undefined,
            progress: form.getValues('progress') || undefined,
            remarks: form.getValues('remarks') || undefined,
            recommendations: form.getValues('recommendations') || undefined,
          }}
          onApply={handleApplyTranscription}
          onDiscard={handleDiscardTranscription}
        />
      )}
    </div>
  );
}
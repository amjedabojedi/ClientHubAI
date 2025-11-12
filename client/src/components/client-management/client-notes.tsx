import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Phone, Mail, FileText, CalendarIcon, Plus, Filter } from "lucide-react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

interface ClientNotesProps {
  clientId: number;
}

const noteSchema = z.object({
  clientId: z.number(),
  noteType: z.enum(["call", "email", "note"]),
  eventDate: z.date(),
  title: z.string().optional(),
  content: z.string().min(1, "Note content is required"),
});

type NoteFormData = z.infer<typeof noteSchema>;

interface Note {
  id: number;
  clientId: number;
  authorId: number;
  noteType: string;
  eventDate: string;
  title: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: number;
    fullName: string;
  };
}

export default function ClientNotes({ clientId }: ClientNotesProps) {
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [filterType, setFilterType] = useState<string[]>(["call", "email", "note"]);
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const { toast } = useToast();

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (startDate) params.append("startDate", startDate.toISOString());
    if (endDate) params.append("endDate", endDate.toISOString());
    return params.toString();
  };

  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["/api/clients", clientId, "notes", startDate, endDate],
    queryFn: async () => {
      const params = buildQueryParams();
      const response = await fetch(`/api/clients/${clientId}/notes?${params}`);
      if (!response.ok) throw new Error("Failed to fetch notes");
      return response.json();
    },
  });

  const filteredNotes = notes.filter(note => filterType.includes(note.noteType));

  const form = useForm<NoteFormData>({
    resolver: zodResolver(noteSchema),
    defaultValues: {
      clientId,
      noteType: "note",
      eventDate: new Date(),
      title: "",
      content: "",
    },
  });

  const createNoteMutation = useMutation({
    mutationFn: async (data: NoteFormData) => {
      const noteData = {
        ...data,
        eventDate: data.eventDate.toISOString(),
      };
      console.log('Sending note data:', noteData);
      return apiRequest("/api/notes", "POST", noteData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
      toast({
        title: "Success",
        description: "Note created successfully",
      });
      setIsAddNoteOpen(false);
      form.reset();
    },
    onError: (error) => {
      console.error('Note creation error:', error);
      toast({
        title: "Error",
        description: "Failed to create note",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: NoteFormData) => {
    console.log('Form data before submit:', data);
    console.log('Form errors:', form.formState.errors);
    createNoteMutation.mutate(data);
  };

  const getNoteIcon = (type: string) => {
    switch (type) {
      case "call":
        return <Phone className="w-4 h-4" />;
      case "email":
        return <Mail className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const getNoteLabel = (type: string) => {
    switch (type) {
      case "call":
        return "Call";
      case "email":
        return "Email";
      default:
        return "Note";
    }
  };

  const formatEventDate = (eventDate: string, createdAt: string) => {
    const event = new Date(eventDate);
    const created = new Date(createdAt);
    const daysDiff = Math.floor((created.getTime() - event.getTime()) / (1000 * 60 * 60 * 24));
    
    return (
      <div>
        <div className="font-medium">{format(event, "MMM d, yyyy")}</div>
        {daysDiff > 0 && (
          <div className="text-xs text-amber-600">
            ⚠️ Late Entry (entered {daysDiff} {daysDiff === 1 ? 'day' : 'days'} later)
          </div>
        )}
        <div className="text-xs text-slate-500">
          Entered: {format(created, "MMM d, yyyy h:mm a")}
        </div>
      </div>
    );
  };

  const toggleFilter = (type: string) => {
    setFilterType(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          onClick={() => setIsAddNoteOpen(true)}
          data-testid="button-add-note"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Note
        </Button>
      </div>

      <div className="bg-slate-50 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-medium text-slate-700">Filter Notes by Date Range or Type</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs text-slate-600">Filter by Type</Label>
            <div className="flex gap-3 mt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterType.includes("call")}
                  onChange={() => toggleFilter("call")}
                  className="rounded"
                  data-testid="filter-call"
                />
                <Phone className="w-4 h-4" />
                <span className="text-sm">Call</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterType.includes("email")}
                  onChange={() => toggleFilter("email")}
                  className="rounded"
                  data-testid="filter-email"
                />
                <Mail className="w-4 h-4" />
                <span className="text-sm">Email</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterType.includes("note")}
                  onChange={() => toggleFilter("note")}
                  className="rounded"
                  data-testid="filter-note"
                />
                <FileText className="w-4 h-4" />
                <span className="text-sm">Note</span>
              </label>
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-600">From Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal mt-1" data-testid="filter-start-date">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {startDate ? format(startDate, "MMM d, yyyy") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label className="text-xs text-slate-600">To Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal mt-1" data-testid="filter-end-date">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {endDate ? format(endDate, "MMM d, yyyy") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={endDate}
                  onSelect={setEndDate}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {(startDate || endDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStartDate(undefined);
              setEndDate(undefined);
            }}
            data-testid="button-clear-dates"
          >
            Clear Dates
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto"></div>
        </div>
      ) : filteredNotes.length === 0 ? (
        <div className="text-center py-8">
          <FileText className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <p className="text-slate-600">No notes found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              data-testid={`note-${note.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                  {getNoteIcon(note.noteType)}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {getNoteLabel(note.noteType)}
                        </span>
                        {note.title && (
                          <>
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-700">{note.title}</span>
                          </>
                        )}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">
                        By: {note.author.fullName}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      {formatEventDate(note.eventDate, note.createdAt)}
                    </div>
                  </div>
                  <div
                    className="prose prose-sm max-w-none text-slate-700"
                    dangerouslySetInnerHTML={{ __html: note.content }}
                    data-testid={`note-content-${note.id}`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={isAddNoteOpen} onOpenChange={setIsAddNoteOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add Client Note</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="noteType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-note-type">
                          <SelectValue placeholder="Select communication type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="call" data-testid="option-call">
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4" />
                            <span>Phone Call</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="email" data-testid="option-email">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            <span>Email</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="note" data-testid="option-note">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            <span>General Note</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="eventDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Communication Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                            data-testid="input-event-date"
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {field.value ? format(field.value, "PPP") : "Pick a date"}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => date > new Date()}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription>
                      When did this communication happen?
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Brief description..."
                        {...field}
                        data-testid="input-title"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Details</FormLabel>
                    <FormControl>
                      <ReactQuill
                        theme="snow"
                        value={field.value}
                        onChange={field.onChange}
                        className="bg-white"
                        modules={{
                          toolbar: [
                            ['bold', 'italic', 'underline'],
                            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                            ['clean']
                          ],
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddNoteOpen(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createNoteMutation.isPending}
                  data-testid="button-save-note"
                >
                  {createNoteMutation.isPending ? "Saving..." : "Save Note"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

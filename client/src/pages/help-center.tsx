import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Search, ThumbsUp, Eye, ArrowLeft, BookOpen } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { HelpGuide } from "@shared/schema";

const CATEGORIES = [
  { value: "all", label: "All Guides" },
  { value: "clients", label: "Client Management" },
  { value: "scheduling", label: "Scheduling" },
  { value: "notes", label: "Session Notes" },
  { value: "tasks", label: "Tasks" },
  { value: "library", label: "Library" },
  { value: "billing", label: "Billing" },
  { value: "assessments", label: "Assessments" },
  { value: "portal", label: "Client Portal" },
  { value: "admin", label: "Administration" },
  { value: "navigation", label: "Navigation" }
];

export default function HelpCenter() {
  const [, params] = useRoute("/help/:slug?");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const selectedSlug = params?.slug;

  const { data: guides = [], isLoading } = useQuery<HelpGuide[]>({
    queryKey: ["/api/help-guides", selectedCategory],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') {
        params.append('category', selectedCategory);
      }
      params.append('active', 'true');
      const url = `/api/help-guides${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch guides');
      return response.json();
    },
    enabled: !selectedSlug && !searchQuery
  });

  const { data: searchResults = [], isLoading: isSearching } = useQuery<HelpGuide[]>({
    queryKey: ["/api/help-guides/search", searchQuery, selectedCategory],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('q', searchQuery);
      if (selectedCategory !== 'all') {
        params.append('category', selectedCategory);
      }
      const response = await fetch(`/api/help-guides/search?${params}`);
      if (!response.ok) throw new Error('Search failed');
      return response.json();
    },
    enabled: !!searchQuery
  });

  const { data: selectedGuide, isLoading: isLoadingGuide } = useQuery<HelpGuide>({
    queryKey: ["/api/help-guides/slug", selectedSlug],
    queryFn: async () => {
      const response = await fetch(`/api/help-guides/slug/${selectedSlug}`);
      if (!response.ok) throw new Error('Guide not found');
      return response.json();
    },
    enabled: !!selectedSlug
  });

  const markHelpfulMutation = useMutation({
    mutationFn: async (guideId: number) => {
      return apiRequest(`/api/help-guides/${guideId}/helpful`, {
        method: 'POST'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/help-guides"] });
    }
  });

  const displayGuides = searchQuery ? searchResults : guides;
  const filteredGuides = selectedCategory === 'all' 
    ? displayGuides 
    : displayGuides.filter(g => g.category === selectedCategory);

  // Guide detail view
  if (selectedSlug) {
    if (isLoadingGuide) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
          <div className="max-w-4xl mx-auto">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-8" />
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (!selectedGuide) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-2xl font-bold mb-4">Guide Not Found</h1>
            <Button onClick={() => window.location.href = '/help'}>
              Back to Help Center
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <Button 
            variant="ghost" 
            onClick={() => window.location.href = '/help'}
            className="mb-6"
            data-testid="button-back-help"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Help Center
          </Button>

          <Card data-testid="card-guide-detail" className="shadow-md">
            <CardHeader className="bg-slate-50 dark:bg-slate-800 border-b">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                      {CATEGORIES.find(c => c.value === selectedGuide.category)?.label}
                    </Badge>
                  </div>
                  <CardTitle className="text-2xl mb-3 text-slate-900 dark:text-white">{selectedGuide.title}</CardTitle>
                  <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <Eye className="h-4 w-4" />
                      {selectedGuide.viewCount} views
                    </span>
                    <span className="flex items-center gap-1">
                      <ThumbsUp className="h-4 w-4" />
                      {selectedGuide.helpfulCount} helpful
                    </span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="prose dark:prose-invert max-w-none">
                <div className="text-slate-700 dark:text-slate-300 space-y-3">
                  {selectedGuide.content.split('\n').map((line, idx) => (
                    <div key={idx} className="leading-relaxed">
                      {line.startsWith('1. ') || line.startsWith('2. ') || line.startsWith('3. ') || line.startsWith('4. ') || line.startsWith('5. ') ? (
                        <div className="flex gap-3 mb-2">
                          <span className="font-semibold text-primary flex-shrink-0">{line.substring(0, 2)}</span>
                          <span dangerouslySetInnerHTML={{ __html: line.substring(3).replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-900 dark:text-white">$1</strong>') }} />
                        </div>
                      ) : line.includes('**') ? (
                        <p dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-900 dark:text-white">$1</strong>') }} />
                      ) : line.trim() ? (
                        <p>{line}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <Separator className="my-6" />

              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex flex-wrap gap-2">
                  {selectedGuide.tags.slice(0, 4).map((tag, idx) => (
                    <Badge key={idx} variant="outline" className="text-slate-600">{tag}</Badge>
                  ))}
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => markHelpfulMutation.mutate(selectedGuide.id)}
                  disabled={markHelpfulMutation.isPending}
                  className="bg-primary hover:bg-primary/90"
                  data-testid="button-mark-helpful"
                >
                  <ThumbsUp className="h-4 w-4 mr-2" />
                  Mark as Helpful
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Guide list view
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-primary/10 p-3 rounded-lg">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Help Center</h1>
              <p className="text-slate-600 dark:text-slate-400 mt-1">
                Step-by-step guides for TherapyFlow features
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <Input
              type="text"
              placeholder="Search guides..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-guides"
            />
          </div>
        </div>

        <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="mb-6">
          <TabsList className="flex-wrap h-auto">
            {CATEGORIES.map((cat) => (
              <TabsTrigger 
                key={cat.value} 
                value={cat.value}
                data-testid={`tab-${cat.value}`}
              >
                {cat.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {(isLoading || isSearching) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : filteredGuides.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                {searchQuery 
                  ? `No guides found for "${searchQuery}"` 
                  : "No guides available in this category"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGuides.map((guide) => (
              <Card 
                key={guide.id} 
                className="hover:shadow-md hover:border-primary/50 transition-all cursor-pointer group"
                onClick={() => window.location.href = `/help/${guide.slug}`}
                data-testid={`card-guide-${guide.slug}`}
              >
                <CardHeader>
                  <CardTitle className="text-lg line-clamp-2 group-hover:text-primary transition-colors">{guide.title}</CardTitle>
                  <CardDescription className="flex items-center gap-3 mt-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-primary/20">
                      {CATEGORIES.find(c => c.value === guide.category)?.label}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Eye className="h-3 w-3" />
                      {guide.viewCount}
                    </span>
                    {guide.helpfulCount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <ThumbsUp className="h-3 w-3" />
                        {guide.helpfulCount}
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-3">
                    {guide.content.substring(0, 120)}...
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

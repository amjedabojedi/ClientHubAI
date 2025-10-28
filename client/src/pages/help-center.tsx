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
  { value: "navigation", label: "Dashboard" },
  { value: "clients", label: "Clients" },
  { value: "scheduling", label: "Scheduling" },
  { value: "billing", label: "Billing" },
  { value: "tasks", label: "Tasks" },
  { value: "notes", label: "Session Notes" },
  { value: "assessments", label: "Assessments" },
  { value: "profile", label: "My Profile" },
  { value: "portal", label: "Client Portal" }
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
      return apiRequest(`/api/help-guides/${guideId}/helpful`, 'POST');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/help-guides"] });
    }
  });

  // Filter out admin-only categories (library, admin only - NOT assessments because therapists use them)
  const EXCLUDED_CATEGORIES = ['library', 'admin'];
  
  const displayGuides = searchQuery ? searchResults : guides;
  const filteredGuides = selectedCategory === 'all' 
    ? displayGuides.filter(g => !EXCLUDED_CATEGORIES.includes(g.category))
    : displayGuides.filter(g => g.category === selectedCategory && !EXCLUDED_CATEGORIES.includes(g.category));

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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6">
        <div className="max-w-4xl mx-auto">
          <Button 
            variant="ghost" 
            onClick={() => window.location.href = '/help'}
            className="mb-4 hover:bg-gray-100 dark:hover:bg-gray-800"
            data-testid="button-back-help"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Help Center
          </Button>

          <Card data-testid="card-guide-detail" className="shadow-sm border-gray-200 dark:border-gray-700">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <Badge 
                    variant="secondary" 
                    className="mb-3 bg-primary/10 text-primary border-primary/20 font-medium"
                  >
                    {CATEGORIES.find(c => c.value === selectedGuide.category)?.label}
                  </Badge>
                  <CardTitle className="text-2xl md:text-3xl mb-3 text-gray-900 dark:text-white font-bold leading-tight">
                    {selectedGuide.title}
                  </CardTitle>
                  <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <Eye className="h-4 w-4" />
                      <span className="font-medium">{selectedGuide.viewCount}</span> views
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ThumbsUp className="h-4 w-4" />
                      <span className="font-medium">{selectedGuide.helpfulCount}</span> helpful
                    </span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-8 pb-8">
              <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none">
                <div className="text-gray-700 dark:text-gray-300 space-y-4">
                  {selectedGuide.content.split('\n').map((line, idx) => (
                    <div key={idx} className="leading-relaxed">
                      {line.startsWith('1. ') || line.startsWith('2. ') || line.startsWith('3. ') || line.startsWith('4. ') || line.startsWith('5. ') || line.startsWith('6. ') || line.startsWith('7. ') || line.startsWith('8. ') || line.startsWith('9. ') ? (
                        <div className="flex gap-3 mb-3 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                          <span className="font-bold text-primary flex-shrink-0 text-base">{line.substring(0, 2)}</span>
                          <span className="flex-1" dangerouslySetInnerHTML={{ __html: line.substring(3).replace(/\*\*(.*?)\*\*/g, '<strong class="text-gray-900 dark:text-white font-semibold">$1</strong>') }} />
                        </div>
                      ) : line.includes('**') ? (
                        <p className="mb-3" dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong class="text-gray-900 dark:text-white font-semibold">$1</strong>') }} />
                      ) : line.trim() ? (
                        <p className="mb-3">{line}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <Separator className="my-8" />

              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex flex-wrap gap-2">
                  {selectedGuide.tags.slice(0, 4).map((tag, idx) => (
                    <Badge 
                      key={idx} 
                      variant="outline" 
                      className="text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
                <Button
                  variant="default"
                  size="default"
                  onClick={() => markHelpfulMutation.mutate(selectedGuide.id)}
                  disabled={markHelpfulMutation.isPending}
                  className="bg-primary hover:bg-primary/90 shadow-sm"
                  data-testid="button-mark-helpful"
                >
                  <ThumbsUp className="h-4 w-4 mr-2" />
                  {markHelpfulMutation.isPending ? "Marking..." : "Mark as Helpful"}
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-primary/10 p-2.5 rounded-lg">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Help Center</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                Step-by-step guides for TherapyFlow
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <Card className="mb-6 border-gray-200 dark:border-gray-700">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search help guides..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 border-gray-300 dark:border-gray-600 focus:ring-primary focus:border-primary"
                data-testid="input-search-guides"
              />
            </div>
          </CardContent>
        </Card>

        {/* Category Tabs */}
        <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="mb-6">
          <TabsList className="flex-wrap h-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-1">
            {CATEGORIES.map((cat) => (
              <TabsTrigger 
                key={cat.value} 
                value={cat.value}
                className="data-[state=active]:bg-primary data-[state=active]:text-white text-sm"
                data-testid={`tab-${cat.value}`}
              >
                {cat.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Guide Cards */}
        {(isLoading || isSearching) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="animate-pulse border-gray-200 dark:border-gray-700">
                <CardHeader className="pb-3">
                  <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                </CardHeader>
                <CardContent>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredGuides.length === 0 ? (
          <Card className="border-gray-200 dark:border-gray-700">
            <CardContent className="py-16 text-center">
              <BookOpen className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">
                {searchQuery 
                  ? `No guides found for "${searchQuery}"` 
                  : "No guides available in this category"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredGuides.map((guide) => (
              <Card 
                key={guide.id} 
                className="hover:shadow-lg hover:border-primary/40 transition-all duration-200 cursor-pointer group border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                onClick={() => window.location.href = `/help/${guide.slug}`}
                data-testid={`card-guide-${guide.slug}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <Badge 
                      variant="secondary" 
                      className="text-xs font-medium bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                    >
                      {CATEGORIES.find(c => c.value === guide.category)?.label}
                    </Badge>
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {guide.viewCount}
                      </span>
                      {guide.helpfulCount > 0 && (
                        <span className="flex items-center gap-1">
                          <ThumbsUp className="h-3 w-3" />
                          {guide.helpfulCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white line-clamp-2 group-hover:text-primary transition-colors leading-tight">
                    {guide.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3 leading-relaxed">
                    {guide.content.substring(0, 150)}...
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

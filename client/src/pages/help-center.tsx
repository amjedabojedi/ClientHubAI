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

          <Card data-testid="card-guide-detail">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-3xl mb-2">{selectedGuide.title}</CardTitle>
                  <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                    <Badge variant="secondary">{CATEGORIES.find(c => c.value === selectedGuide.category)?.label}</Badge>
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {selectedGuide.viewCount} views
                    </span>
                    <span className="flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3" />
                      {selectedGuide.helpfulCount} helpful
                    </span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="prose dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-base leading-relaxed">{selectedGuide.content}</pre>
              </div>

              <Separator className="my-6" />

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  {selectedGuide.tags.map((tag, idx) => (
                    <Badge key={idx} variant="outline">{tag}</Badge>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => markHelpfulMutation.mutate(selectedGuide.id)}
                  disabled={markHelpfulMutation.isPending}
                  data-testid="button-mark-helpful"
                >
                  <ThumbsUp className="h-4 w-4 mr-2" />
                  Helpful
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <BookOpen className="h-8 w-8 text-blue-600" />
            <h1 className="text-4xl font-bold">Help Center</h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            Find guides and tutorials to help you navigate TherapyFlow
          </p>
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
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => window.location.href = `/help/${guide.slug}`}
                data-testid={`card-guide-${guide.slug}`}
              >
                <CardHeader>
                  <CardTitle className="text-lg line-clamp-2">{guide.title}</CardTitle>
                  <CardDescription className="flex items-center gap-4 mt-2">
                    <Badge variant="secondary" className="text-xs">
                      {CATEGORIES.find(c => c.value === guide.category)?.label}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs">
                      <Eye className="h-3 w-3" />
                      {guide.viewCount}
                    </span>
                    <span className="flex items-center gap-1 text-xs">
                      <ThumbsUp className="h-3 w-3" />
                      {guide.helpfulCount}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
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

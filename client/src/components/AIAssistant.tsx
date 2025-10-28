import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Sparkles, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface AIAssistantProps {
  currentPage?: string;
}

export default function AIAssistant({ currentPage = "dashboard" }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<Message[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch quick suggestions based on current page
  const { data: suggestionsData } = useQuery({
    queryKey: ["/api/ai-assistant/suggestions", currentPage],
    queryFn: async () => {
      const response = await fetch(`/api/ai-assistant/suggestions?page=${currentPage}`);
      if (!response.ok) throw new Error("Failed to fetch suggestions");
      return response.json();
    },
    enabled: isOpen,
  });

  const suggestions = suggestionsData?.suggestions || [];

  // Chat mutation
  const chatMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const response = await apiRequest("/api/ai-assistant/chat", "POST", {
        message: userMessage,
        currentPage
      });
      
      return response.json();
    },
    onSuccess: (data: any) => {
      setConversation(prev => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          timestamp: data.timestamp
        }
      ]);
      setShowSuggestions(false);
    },
  });

  const handleSend = () => {
    if (!message.trim() || chatMutation.isPending) return;

    const userMessage: Message = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString()
    };

    setConversation(prev => [...prev, userMessage]);
    chatMutation.mutate(message);
    setMessage("");
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (!suggestion.trim() || chatMutation.isPending) return;

    const userMessage: Message = {
      role: "user",
      content: suggestion,
      timestamp: new Date().toISOString()
    };

    setConversation(prev => [...prev, userMessage]);
    chatMutation.mutate(suggestion);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation]);

  // Reset conversation when closing
  const handleClose = () => {
    setIsOpen(false);
  };

  const handleClearChat = () => {
    setConversation([]);
    setShowSuggestions(true);
  };

  return (
    <>
      {/* Floating chat button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full px-5 py-3 shadow-lg transition-all hover:shadow-xl"
          data-testid="button-open-ai-assistant"
        >
          <Sparkles className="w-5 h-5" />
          <span className="font-medium">Need Help?</span>
        </button>
      )}

      {/* Chat widget */}
      {isOpen && (
        <Card className="fixed bottom-6 right-6 z-50 w-96 h-[600px] shadow-2xl flex flex-col">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                <CardTitle className="text-lg">TherapyFlow Assistant</CardTitle>
              </div>
              <div className="flex items-center gap-1">
                {conversation.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearChat}
                    className="text-white hover:bg-blue-600"
                    title="Clear chat"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  className="text-white hover:bg-blue-600"
                  data-testid="button-close-ai-assistant"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-blue-100 mt-1">
              Navigation help and guidance for TherapyFlow
            </p>
          </CardHeader>

          <CardContent className="flex-1 p-4 flex flex-col overflow-hidden">
            {/* Messages */}
            <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
              {conversation.length === 0 ? (
                <div className="text-center py-8">
                  <Sparkles className="w-12 h-12 mx-auto text-blue-600 mb-3" />
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                    Welcome! How can I help?
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    I can help you navigate TherapyFlow and answer your questions.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {conversation.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2 ${
                          msg.role === "user"
                            ? "bg-blue-600 text-white"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  {chatMutation.isPending && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Quick suggestions */}
              {showSuggestions && suggestions.length > 0 && conversation.length === 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                    Quick questions:
                  </p>
                  <div className="space-y-2">
                    {suggestions.map((suggestion: string, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="w-full text-left text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 transition-colors"
                        data-testid={`button-suggestion-${idx}`}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </ScrollArea>

            {/* Input area */}
            <div className="mt-4 flex items-center gap-2">
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your question..."
                className="flex-1"
                disabled={chatMutation.isPending}
                data-testid="input-ai-message"
              />
              <Button
                onClick={handleSend}
                disabled={!message.trim() || chatMutation.isPending}
                size="icon"
                data-testid="button-send-message"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>

            {chatMutation.isError && (
              <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                Failed to send message. Please try again.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

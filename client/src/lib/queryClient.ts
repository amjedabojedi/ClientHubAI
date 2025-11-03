import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    // Debug logging for duplicate detection errors
    if (res.url.includes('/duplicates')) {
      console.error('[QUERY CLIENT] Response failed:', {
        status: res.status,
        statusText: res.statusText,
        url: res.url,
        responseBody: text
      });
    }
    
    // Try to parse as JSON and extract clean message
    let errorMessage = null;
    try {
      const json = JSON.parse(text);
      if (json.message) {
        errorMessage = json.message;
      }
    } catch (parseError) {
      // Not valid JSON, will use fallback
    }
    
    // Throw the appropriate error message
    if (errorMessage) {
      throw new Error(errorMessage);
    } else {
      throw new Error(`${res.status}: ${text}`);
    }
  }
}

// Helper function to get CSRF token from cookies
function getCsrfToken(): string | null {
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'csrfToken') {
      return decodeURIComponent(value);
    }
  }
  return null;
}

export async function apiRequest(
  url: string,
  method: string,
  data?: unknown | undefined,
): Promise<Response> {
  const options: RequestInit = {
    method,
    credentials: "include",
  };

  // Add headers for non-GET/HEAD requests
  if (method !== 'GET' && method !== 'HEAD') {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    
    // Add CSRF token for non-GET requests
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
    
    options.headers = headers;
    
    if (data) {
      options.body = JSON.stringify(data);
    }
  }

  // Add cache busting for GET requests to prevent 304 responses
  if (method === 'GET' || method === 'HEAD') {
    options.cache = "no-store";
    options.headers = {
      ...options.headers,
      "Cache-Control": "no-cache",
    };
  }

  const res = await fetch(url, options);
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    let url: string;
    
    if (queryKey.length === 1) {
      // Simple URL without parameters
      url = queryKey[0] as string;
    } else if (queryKey.length === 2 && typeof queryKey[1] === 'object') {
      // URL with query parameters
      const baseUrl = queryKey[0] as string;
      const params = queryKey[1] as Record<string, any>;
      const searchParams = new URLSearchParams();
      
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          // Handle arrays by appending each item separately
          if (Array.isArray(value)) {
            value.forEach(item => {
              if (item !== undefined && item !== null && item !== '') {
                searchParams.append(key, String(item));
              }
            });
          } else {
            searchParams.append(key, String(value));
          }
        }
      });
      
      const queryString = searchParams.toString();
      url = queryString ? `${baseUrl}?${queryString}` : baseUrl;
    } else {
      // Fallback to join for other cases
      url = queryKey.filter(key => typeof key === 'string').join('/');
    }

    const res = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
      },
    });

    if (res.status === 401) {
      // Handle authentication failures
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
      
      // Clear any stored auth state to prevent endless loops
      localStorage.removeItem('currentUser');
      
      // Force a complete page reload to reset all React state and redirect to login
      window.location.replace('/login');
      return;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes - prevents stale credentials from persisting indefinitely
      retry: false,
      // Add small stagger to prevent simultaneous requests
      refetchOnMount: "always",
    },
    mutations: {
      retry: false,
    },
  },
});

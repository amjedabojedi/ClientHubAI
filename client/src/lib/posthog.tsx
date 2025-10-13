import { createContext, useContext, useEffect, ReactNode } from 'react';
import posthog from 'posthog-js';

interface PostHogContextType {
  posthog: typeof posthog | null;
}

const PostHogContext = createContext<PostHogContextType>({ posthog: null });

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
    const host = import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com';

    // Only initialize if API key is provided
    if (apiKey && typeof window !== 'undefined') {
      posthog.init(apiKey, {
        api_host: host,
        // Capture pageviews automatically
        capture_pageview: true,
        // Capture performance metrics
        capture_performance: true,
        // Privacy-friendly settings
        persistence: 'localStorage',
        // Disable session recording by default (can be enabled later)
        disable_session_recording: false,
        // Security: Use secure cookies
        secure_cookie: true,
        // Helpful for debugging
        loaded: (posthog) => {
          if (import.meta.env.DEV) {
            console.log('PostHog initialized successfully');
          }
        },
      });
    } else if (import.meta.env.DEV) {
      console.warn('PostHog not initialized: Missing VITE_POSTHOG_API_KEY');
    }

    return () => {
      // Cleanup on unmount
      if (apiKey) {
        posthog.reset();
      }
    };
  }, []);

  return (
    <PostHogContext.Provider value={{ posthog }}>
      {children}
    </PostHogContext.Provider>
  );
}

export function usePostHog() {
  const context = useContext(PostHogContext);
  if (!context) {
    throw new Error('usePostHog must be used within PostHogProvider');
  }
  return context.posthog;
}

// Helper function to track events safely
export function trackEvent(eventName: string, properties?: Record<string, any>) {
  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
  if (apiKey && posthog) {
    posthog.capture(eventName, properties);
  }
}

// Helper to identify users
export function identifyUser(userId: string, properties?: Record<string, any>) {
  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
  if (apiKey && posthog) {
    posthog.identify(userId, properties);
  }
}

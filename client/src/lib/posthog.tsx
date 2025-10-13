import { createContext, useContext, useEffect, ReactNode } from 'react';
import posthog from 'posthog-js';

interface PostHogContextType {
  posthog: typeof posthog | null;
}

const PostHogContext = createContext<PostHogContextType>({ posthog: null });

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const apiKey = import.meta.env.VITE_POSTHOG_API_KEY || 'phc_gFMtGnO2mkibMq3zQ5vLyNRCSr0jSN8tDNkozQexJ03';
    const host = import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com';

    if (typeof window !== 'undefined') {
      posthog.init(apiKey, {
        api_host: host,
        // Capture pageviews automatically
        capture_pageview: true,
        // Capture performance metrics
        capture_performance: true,
        // Privacy-friendly settings
        persistence: 'localStorage',
        // Disable session recording by default (can be enabled via env var)
        disable_session_recording: import.meta.env.VITE_POSTHOG_ENABLE_RECORDING !== 'true',
        // Security: Use secure cookies
        secure_cookie: true,
        // Helpful for debugging
        loaded: (posthog) => {
          if (import.meta.env.DEV) {
            console.log('PostHog initialized successfully');
          }
        },
      });
    }

    return () => {
      // Cleanup on unmount
      posthog.reset();
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
  if (posthog) {
    posthog.capture(eventName, properties);
  }
}

// Helper to identify users
export function identifyUser(userId: string, properties?: Record<string, any>) {
  if (posthog) {
    posthog.identify(userId, properties);
  }
}

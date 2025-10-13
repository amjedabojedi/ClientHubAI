# PostHog Analytics Tracking Guide

## Overview
PostHog is now integrated into TherapyFlow to help you understand how the system is being used and identify areas for improvement.

## Current Tracking Events

### User Authentication
- **Event:** `user_logged_in`
  - Tracks when users successfully log in
  - Properties: `role`, `username`
  - Location: `client/src/hooks/useAuth.ts`

### Client Management
- **Event:** `client_created`
  - Tracks when a new client is added
  - Properties: `clientType`, `hasPortalAccess`, `stage`, `status`
  - Location: `client/src/components/client-management/add-client-modal.tsx`

## How to Add More Tracking Events

### Step 1: Import the tracking function
```typescript
import { trackEvent } from "@/lib/posthog";
```

### Step 2: Call trackEvent where the action happens
```typescript
// In a mutation's onSuccess callback:
const createSessionMutation = useMutation({
  mutationFn: (data) => apiRequest("/api/sessions", "POST", data),
  onSuccess: (response, variables) => {
    // Track the event
    trackEvent('session_scheduled', {
      therapistId: variables.therapistId,
      serviceType: variables.serviceType,
      duration: variables.duration,
    });
    
    // Rest of your success logic...
  },
});
```

## Recommended Events to Add

### Session Management
- `session_scheduled` - When a new session is booked
- `session_completed` - When a session is marked complete
- `session_cancelled` - When a session is cancelled
- `session_rescheduled` - When a session date/time changes

### Clinical Notes
- `note_created` - When a session note is saved
- `note_updated` - When a note is edited
- `assessment_completed` - When an assessment is finished

### Billing
- `invoice_created` - When an invoice is generated
- `payment_processed` - When a payment is recorded
- `billing_error` - When a billing issue occurs

### Search & Navigation
- `search_performed` - Track what users search for
- `feature_accessed` - Track which features are used most

## Best Practices

1. **Don't track sensitive information**
   - ❌ Don't include: client names, PHI, session notes content
   - ✅ Do include: counts, categories, feature usage

2. **Use descriptive event names**
   - Use snake_case: `session_scheduled` not `sessionScheduled`
   - Be specific: `assessment_completed` not just `completed`

3. **Include relevant properties**
   - Add context that helps you understand the event
   - Keep properties simple and categorical when possible

4. **Track errors for debugging**
   ```typescript
   onError: (error) => {
     trackEvent('error_occurred', {
       feature: 'client_creation',
       errorType: error.message
     });
   }
   ```

## Privacy & Security

- PostHog credentials are stored as environment variables (VITE_POSTHOG_API_KEY, VITE_POSTHOG_HOST)
- The integration only initializes if credentials are present
- User identification uses user IDs, not sensitive personal information
- All tracking is HIPAA-compliant when configured properly

## Viewing Analytics

1. Log in to PostHog at https://app.posthog.com
2. Navigate to "Insights" to create dashboards
3. Use "Events" to see all tracked events
4. Create "Funnels" to understand user journeys
5. Watch "Session Recordings" to see real user interactions

## Common Use Cases

### Understanding Feature Usage
```
Question: "Are therapists using the assessment feature?"
Solution: Check the `assessment_completed` event count
```

### Identifying Friction Points
```
Question: "Where do users struggle with scheduling?"
Solution: Compare `session_scheduled` success vs `error_occurred` with feature: 'scheduling'
```

### Tracking System Growth
```
Question: "How many new clients per week?"
Solution: Create a trend chart for `client_created` events
```

## Need Help?

- PostHog Docs: https://posthog.com/docs
- Feature Flags: https://posthog.com/docs/feature-flags
- A/B Testing: https://posthog.com/docs/experiments

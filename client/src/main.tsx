import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

// Global error handlers to prevent unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  // Filter out browser extension errors that cause runtime overlay issues
  const reason = event.reason?.toString() || '';
  if (reason.includes('Extension context invalidated') || 
      reason.includes('message port closed') ||
      reason.includes('runtime.lastError')) {
    // Silently ignore browser extension errors
    event.preventDefault();
    return;
  }
  
  console.error('Unhandled promise rejection:', event.reason);
  // Prevent the default handler from running to avoid runtime error overlay
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  // Filter out browser extension errors that cause runtime overlay issues
  const message = event.message?.toString() || '';
  const filename = event.filename?.toString() || '';
  
  if (message.includes('Extension context invalidated') || 
      message.includes('message port closed') ||
      message.includes('runtime.lastError') ||
      filename.includes('extension://') ||
      filename.includes('chrome-extension://') ||
      event.error === null) {
    // Silently ignore browser extension errors
    event.preventDefault();
    return;
  }
  
  console.error('Global error:', event.error);
  // Prevent the error from propagating to avoid runtime error overlay
  event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

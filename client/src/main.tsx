import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

// Enhanced global error handlers for Edge browser compatibility
window.addEventListener('unhandledrejection', (event) => {
  // Filter out browser extension errors and Edge-specific issues
  const reason = event.reason?.toString() || '';
  const stack = event.reason?.stack?.toString() || '';
  
  if (reason.includes('Extension context invalidated') || 
      reason.includes('message port closed') ||
      reason.includes('runtime.lastError') ||
      reason.includes('ResizeObserver loop limit exceeded') ||
      reason.includes('Non-Error promise rejection captured') ||
      stack.includes('extension://') ||
      stack.includes('moz-extension://') ||
      reason.includes('Script error')) {
    // Silently ignore browser extension and Edge-specific errors
    event.preventDefault();
    return;
  }
  
  // Only log actual application errors, not browser/extension errors
  if (reason && !reason.includes('Script error')) {
    console.error('Unhandled promise rejection:', event.reason);
  }
  // Always prevent the default handler to avoid runtime error overlay
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  // Enhanced filtering for Edge browser compatibility
  const message = event.message?.toString() || '';
  const filename = event.filename?.toString() || '';
  const source = event.source?.toString() || '';
  
  if (message.includes('Extension context invalidated') || 
      message.includes('message port closed') ||
      message.includes('runtime.lastError') ||
      message.includes('ResizeObserver loop limit exceeded') ||
      message.includes('Script error') ||
      message.includes('Non-Error promise rejection') ||
      filename.includes('extension://') ||
      filename.includes('chrome-extension://') ||
      filename.includes('moz-extension://') ||
      source.includes('extension://') ||
      event.error === null ||
      event.lineno === 0 && event.colno === 0) {
    // Silently ignore browser extension and cross-origin errors
    event.preventDefault();
    return;
  }
  
  // Only log actual application errors
  if (event.error && message && !message.includes('Script error')) {
    console.error('Global error:', event.error);
  }
  // Always prevent the error from propagating to avoid runtime error overlay
  event.preventDefault();
});

// Additional Edge browser compatibility for runtime error overlay
const isEdgeBrowser = /Edg\//.test(navigator.userAgent);
const isFullPage = window.self === window.top;

if (isEdgeBrowser && isFullPage) {
  // Disable runtime error overlay in Edge full-page mode by intercepting its error handler
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const errorMessage = args.join(' ');
    // Filter out runtime error overlay triggers in Edge
    if (errorMessage.includes('[plugin:runtime-error-plugin]') ||
        errorMessage.includes('Unknown runtime error') ||
        errorMessage.includes('Script error')) {
      return; // Don't log these errors in Edge full-page mode
    }
    originalConsoleError.apply(console, args);
  };
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

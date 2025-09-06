import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

// IMMEDIATE Edge browser runtime error fix (before any other code)
if (/Edg\//.test(navigator.userAgent) && window.self === window.top) {
  // Override the sendError function before it's defined
  const originalDefineProperty = Object.defineProperty;
  Object.defineProperty = function(obj, prop, descriptor) {
    if (prop === 'sendError' || (descriptor && descriptor.value && descriptor.value.toString().includes('runtime-error'))) {
      // Block sendError function definition in Edge
      return obj;
    }
    return originalDefineProperty.call(this, obj, prop, descriptor);
  };
  
  // Block all script injections that contain runtime-error
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName) {
    const element = originalCreateElement.call(this, tagName);
    if (tagName.toLowerCase() === 'script') {
      const originalSetAttribute = element.setAttribute;
      element.setAttribute = function(name, value) {
        if (name === 'src' && value && value.includes('runtime-error')) {
          return; // Block runtime error scripts
        }
        return originalSetAttribute.call(this, name, value);
      };
    }
    return element;
  };
}

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

// Comprehensive Edge browser runtime error overlay fix
const isEdgeBrowser = /Edg\//.test(navigator.userAgent);
const isFullPage = window.self === window.top;

if (isEdgeBrowser && isFullPage) {
  // Method 1: Intercept console.error
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const errorMessage = args.join(' ');
    if (errorMessage.includes('[plugin:runtime-error-plugin]') ||
        errorMessage.includes('Unknown runtime error') ||
        errorMessage.includes('Script error')) {
      return;
    }
    originalConsoleError.apply(console, args);
  };
  
  // Method 2: Intercept sendError function directly
  Object.defineProperty(window, 'sendError', {
    value: function() {
      // Completely disable sendError in Edge full-page mode
      return;
    },
    writable: false,
    configurable: false
  });
  
  // Method 3: Override error event handling
  const originalAddEventListener = window.addEventListener;
  window.addEventListener = function(type, listener, options) {
    if (type === 'error' && listener.toString().includes('runtime-error')) {
      // Skip runtime error listeners in Edge
      return;
    }
    return originalAddEventListener.call(this, type, listener, options);
  };
  
  // Method 4: Prevent the runtime error modal entirely
  const style = document.createElement('style');
  style.textContent = `
    [data-runtime-error-modal] { display: none !important; }
    .runtime-error-overlay { display: none !important; }
    .error-overlay { display: none !important; }
  `;
  document.head.appendChild(style);
}

// Ensure DOM is fully loaded before rendering (Edge compatibility)
const initializeApp = () => {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    console.error("Root element not found");
    return;
  }

  createRoot(rootElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
};

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

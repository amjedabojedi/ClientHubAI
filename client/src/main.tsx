import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

// Global error handlers to prevent unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Log the details for debugging
  console.error('Promise rejection details:', {
    reason: event.reason,
    stack: event.reason?.stack,
    promise: event.promise
  });
  // Prevent the default handler from running to avoid runtime error overlay
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  // Log the details for debugging  
  console.error('Error details:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  });
  // Prevent the error from propagating to avoid runtime error overlay
  event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

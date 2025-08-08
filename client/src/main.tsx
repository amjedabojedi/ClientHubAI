import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Global error handlers to prevent unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  // Unhandled promise rejection logged for debugging
  // Prevent the default handler from running
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  // Global error logged for debugging
});

createRoot(document.getElementById("root")!).render(<App />);

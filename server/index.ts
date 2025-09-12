import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { optionalAuth, csrfProtection } from "./auth-middleware";

const app = express();
// Increase payload limits for document uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Cookie parsing middleware
app.use(cookieParser());

// Optional authentication - sets req.user if valid session exists
app.use(optionalAuth);

// CSRF protection for all API routes except auth endpoints (POST/PUT/DELETE)
app.use('/api', (req, res, next) => {
  // Skip CSRF for login endpoint (it creates the CSRF token)
  if (req.path === '/auth/login' || req.path === '/auth/logout') {
    return next();
  }
  return csrfProtection(req, res, next);
});

// Simple request logging for production
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path.startsWith("/api")) {
      log(`${req.method} ${req.path} ${res.statusCode} in ${duration}ms`);
    }
  });
  next();
});

(async () => {
  // Use comprehensive routing system
  const server = await registerRoutes(app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Only send response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    
    // Log the error but don't re-throw to prevent runtime error overlay
    console.error(`Error on ${req.method} ${req.path}:`, err);
    next();
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
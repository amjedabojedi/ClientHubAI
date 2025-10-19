import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { optionalAuth, csrfProtection } from "./auth-middleware";
import { storage } from "./storage";
import { syncNotificationTriggers } from "./notification-seeds";
import { notificationService } from "./notification-service";

const app = express();
const PORT = Number(process.env.PORT) || 5000;
// Increase payload limits for document uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Cookie parsing middleware
app.use(cookieParser());

// Optional authentication - sets req.user if valid session exists
app.use(optionalAuth);

// CSRF protection for all API routes except public endpoints (POST/PUT/DELETE)
app.use('/api', (req, res, next) => {
  // Skip CSRF for public endpoints and all portal routes (portal uses cookie-based auth)
  const publicPaths = [
    '/auth/login',
    '/auth/logout',
    '/portal/login',
    '/portal/logout',
    '/portal/activate',
    '/portal/forgot-password',
    '/portal/reset-password'
  ];
  
  // Skip CSRF for exact public paths OR all portal routes
  if (publicPaths.includes(req.path) || req.path.startsWith('/portal/')) {
    return next();
  }
  
  return csrfProtection(req, res, next);
});

// Health check endpoint - must be before other routes to ensure it's accessible
app.get('/health', async (req, res) => {
  try {
    // Check if server is responsive
    const healthCheck: any = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      port: PORT
    };

    // Test database connectivity
    try {
      await storage.getUsers();
      healthCheck.database = 'connected';
    } catch (dbError) {
      healthCheck.database = 'error';
      healthCheck.status = 'degraded';
      log(`Health check - Database error: ${dbError}`);
    }

    // Return appropriate status code
    const statusCode = healthCheck.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(healthCheck);
  } catch (error) {
    log(`Health check failed: ${error}`);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
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

// Track server instance for graceful shutdown
let server: any = null;

// Graceful shutdown handler
function gracefulShutdown(signal: string) {
  log(`Received ${signal}, starting graceful shutdown...`);
  
  if (server) {
    server.close((err: any) => {
      if (err) {
        log(`Error during server shutdown: ${err}`);
        process.exit(1);
      }
      
      log('Server closed successfully');
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      log('Forcing shutdown due to timeout');
      process.exit(1);
    }, 30000);
  } else {
    process.exit(0);
  }
}

// Register graceful shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // For nodemon

// Enhanced startup with comprehensive error handling
(async () => {
  try {
    log('Starting application initialization...');
    
    // Test critical dependencies first
    try {
      log('Testing database connectivity...');
      await storage.getUsers();
      log('Database connection verified');
    } catch (dbError) {
      log(`Database connection failed: ${dbError}`);
      throw new Error(`Database initialization failed: ${dbError}`);
    }

    // Synchronize notification triggers from code to database
    try {
      log('Synchronizing notification triggers...');
      await syncNotificationTriggers();
      log('Notification triggers synchronized successfully');
    } catch (syncError) {
      log(`Warning: Failed to sync notification triggers: ${syncError}`);
      // Don't throw - allow app to start even if trigger sync fails
    }

    // Start scheduled notification processor (runs every minute)
    try {
      log('Starting scheduled notification processor...');
      setInterval(async () => {
        try {
          await notificationService.processDueNotifications();
        } catch (error) {
          console.error('[CRON] Error processing scheduled notifications:', error);
        }
      }, 60000); // Run every 60 seconds
      log('Scheduled notification processor started (runs every 60 seconds)');
    } catch (cronError) {
      log(`Warning: Failed to start notification processor: ${cronError}`);
      // Don't throw - allow app to start even if cron fails
    }

    log('Registering routes...');
    server = await registerRoutes(app);
    log('Routes registered successfully');

    // Enhanced error handler with better logging
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      const timestamp = new Date().toISOString();

      // Only send response if headers haven't been sent yet
      if (!res.headersSent) {
        res.status(status).json({ 
          message,
          timestamp,
          path: req.path,
          method: req.method
        });
      }
      
      // Enhanced error logging
      log(`[ERROR] ${timestamp} - ${req.method} ${req.path} - Status: ${status} - ${message}`);
      if (err.stack) {
        console.error('Stack trace:', err.stack);
      }
      next();
    });

    // Setup development or production serving
    log('Setting up application serving...');
    if (app.get("env") === "development") {
      log('Configuring development mode with Vite...');
      await setupVite(app, server);
      log('Vite development server configured');
    } else {
      log('Configuring production mode with static files...');
      serveStatic(app);
      log('Static file serving configured');
    }

    // Start the server with enhanced logging
    const port = PORT;
    const host = "0.0.0.0";
    
    log(`Starting server on ${host}:${port}...`);
    
    server.listen({
      port,
      host,
      reusePort: true,
    }, () => {
      const env = process.env.NODE_ENV || 'development';
      log(`🚀 Server successfully started!`);
      log(`   Environment: ${env}`);
      log(`   Address: http://${host}:${port}`);
      log(`   Health check: http://${host}:${port}/health`);
      log(`   Process ID: ${process.pid}`);
      log(`   Uptime: ${process.uptime()}s`);
      log('Application is ready to accept connections');
    });
    
    // Handle server startup errors
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        log(`Port ${port} is already in use`);
      } else {
        log(`Server error: ${error}`);
      }
      process.exit(1);
    });
    
  } catch (startupError) {
    log(`❌ Application startup failed: ${startupError}`);
    if (startupError instanceof Error && startupError.stack) {
      console.error('Startup error stack trace:', startupError.stack);
    }
    
    // Give some time for logs to flush
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
})().catch((error) => {
  log(`❌ Unhandled startup error: ${error}`);
  console.error('Unhandled error stack trace:', error);
  process.exit(1);
});
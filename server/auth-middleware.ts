import { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";

// Server secret for signing tokens - REQUIRED environment variable for security
let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('WARNING: JWT_SECRET environment variable is missing - using temporary QA secret');
  console.error('CRITICAL: This configuration is ONLY for QA testing - DO NOT DEPLOY TO PRODUCTION');
  console.error('Please set JWT_SECRET to a secure random string before production deployment');
  // Temporary QA fallback - MUST be removed before production
  JWT_SECRET = "qa-testing-secret-" + Date.now();
  process.env.JWT_SECRET = JWT_SECRET;
}
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

interface TokenPayload {
  id: number;
  username: string;
  role: string;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

/**
 * Create a signed session token
 */
export function createSessionToken(user: { id: number; username: string; role: string }): string {
  const payload: TokenPayload = {
    id: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + TOKEN_EXPIRY
  };
  
  const payloadStr = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', JWT_SECRET!)
    .update(payloadStr)
    .digest('hex');
  
  return `${Buffer.from(payloadStr).toString('base64')}.${signature}`;
}

/**
 * Verify and decode a session token
 */
export function verifySessionToken(token: string): TokenPayload | null {
  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;
    
    const payloadStr = Buffer.from(payloadB64, 'base64').toString();
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET!)
      .update(payloadStr)
      .digest('hex');
    
    // Verify signature
    if (signature !== expectedSignature) return null;
    
    const payload: TokenPayload = JSON.parse(payloadStr);
    
    // Check expiry
    if (Date.now() > payload.exp) return null;
    
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Authentication middleware - verifies session cookie and sets req.user
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.sessionToken;
  
  // Temporary debugging - remove after fixing auth
  console.log('[auth-debug] requireAuth called for:', req.path);
  console.log('[auth-debug] Cookie header:', req.headers.cookie ? 'present' : 'missing');
  console.log('[auth-debug] Parsed cookies:', req.cookies ? Object.keys(req.cookies) : 'undefined');
  console.log('[auth-debug] sessionToken:', token ? 'present' : 'missing');
  
  if (!token) {
    console.log('[auth-debug] 401 - No session token');
    return res.status(401).json({ error: "Authentication required" });
  }
  
  const user = verifySessionToken(token);
  if (!user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
  
  req.user = user;
  next();
}

/**
 * Optional authentication middleware - sets req.user if valid session exists
 */
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.sessionToken;
  
  if (token) {
    const user = verifySessionToken(token);
    if (user) {
      req.user = user;
    }
  }
  
  next();
}

/**
 * CSRF protection middleware
 */
export function csrfProtection(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  
  const csrfToken = req.headers['x-csrf-token'] as string;
  const cookieCsrf = req.cookies?.csrfToken;
  
  if (!csrfToken || !cookieCsrf || csrfToken !== cookieCsrf) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  
  next();
}
import { Router } from "express";
import { AuthenticatedRequest, requireAuth } from "./auth-middleware";

const router = Router();

/**
 * GET /api/auth/me - Get current user info from session
 */
router.get("/me", requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    id: req.user!.id,
    username: req.user!.username,
    role: req.user!.role
  });
});

/**
 * POST /api/auth/logout - Clear session cookies
 */
router.post("/logout", (req, res) => {
  // Use the same cookie settings as login for proper clearing
  const isProduction = process.env.NODE_ENV === 'production';
  const useSecure = process.env.USE_SECURE_COOKIES === 'true';
  const isReplit = process.env.REPLIT_ENVIRONMENT === 'true';
  
  const cookieSecure = isProduction || useSecure;
  const cookieSameSite = isReplit && isProduction ? 'none' : 'strict';
  
  res.clearCookie('sessionToken', {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: '/'
  });
  res.clearCookie('csrfToken', {
    httpOnly: false,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: '/'
  });
  
  res.json({ success: true });
});

export default router;
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
  res.clearCookie('sessionToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  res.clearCookie('csrfToken', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production', 
    sameSite: 'strict'
  });
  
  res.json({ success: true });
});

export default router;
import { Router } from 'express';
import { login, logout, getUs, getMySessions, revokeMySession, sessionEvents, lockDeviceFingerprint, unlockDeviceFingerprint, setup2FA, verify2FA } from '../controllers/AuthController';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { authRateLimit } from '../middleware/rateLimit';

const router = Router();

// 登录接口使用严格的速率限制
router.post('/login', authRateLimit, login);
router.post('/2fa/setup', authRateLimit, setup2FA);
router.post('/2fa/verify', authRateLimit, verify2FA);
router.post('/logout', logout);
router.get('/get-us', authenticateToken, getUs);
router.get(
  '/sessions',
  authenticateToken,
  requirePermission('view:device_sessions'),
  getMySessions
);
router.post(
  '/sessions/:id/revoke',
  authenticateToken,
  requirePermission('action:device_session_revoke'),
  revokeMySession
);
router.post(
  '/sessions/:id/lock',
  authenticateToken,
  requirePermission('action:device_fingerprint_lock'),
  lockDeviceFingerprint
);
router.post(
  '/sessions/:id/unlock',
  authenticateToken,
  requirePermission('action:device_fingerprint_lock'),
  unlockDeviceFingerprint
);

router.get('/session-events', sessionEvents);

export default router;

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, getUs, getMySessions, revokeMySession, sessionEvents, lockDeviceFingerprint, unlockDeviceFingerprint, setup2FA, verify2FA } from '../controllers/AuthController';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { 
    // Disable IPv6 subnet validation warning since we handle it manually
    // Use the correct option name based on error message 'ipv6SubnetOrKeyGenerator'
    // @ts-ignore
    ipv6SubnetOrKeyGenerator: false,
    // @ts-ignore
    keyGeneratorIpFallback: false
  },
  keyGenerator: (req) => {
    // 1. Get raw IP
    let ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();

    // 2. Normalize IPv6 to /64 subnet to prevent subnet spam
    if (ip && ip.includes(':')) {
      const parts = ip.split(':');
      if (parts.length >= 4) {
        ip = parts.slice(0, 4).join(':') + '::/64';
      }
    }

    // 3. Composite Key: IP + x-ap header (if available)
    // This ensures that if a user rotates IPs but keeps the same API key header (e.g. from a script), they are still limited.
    const apiKeyHeader = req.headers['x-ap'];
    const apSuffix = typeof apiKeyHeader === 'string' ? `|ap:${apiKeyHeader}` : '';

    // 4. Fallback to username if available in body (as secondary strict limit)
    const body: any = (req as any).body || {};
    const username = typeof body.username === 'string' && body.username.trim().length > 0 ? body.username.trim() : null;
    const userSuffix = username ? `|user:${username}` : '';

    return `login:${ip}${apSuffix}${userSuffix}`;
  },
  handler: (req, res, next, options) => {
    // Log the limit breach
    console.warn(`Rate limit exceeded for IP: ${req.ip}, User: ${req.body?.username}`);
    res.status(options.statusCode).send(options.message);
  },
  message: { message: 'Too many login attempts. Please try again later.' },
});

router.post('/login', loginLimiter, login);
router.post('/2fa/setup', setup2FA);
router.post('/2fa/verify', verify2FA);
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

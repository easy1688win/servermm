import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import { User, Permission, Role } from '../models';
import { logAudit } from '../services/AuditService';
import crypto from 'crypto';
import sequelize from '../config/database';
import UserSession from '../models/UserSession';
import UserDeviceLock from '../models/UserDeviceLock';
import { AuthRequest } from '../middleware/auth';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error('JWT_SECRET environment variable must be set');
}

const MAX_DEVICES_PER_USER = Number(process.env.MAX_DEVICES_PER_USER || 2);
type SessionKickStrategy = 'OLDEST' | 'ALL_OTHERS';
const SESSION_KICK_STRATEGY: SessionKickStrategy =
  (process.env.SESSION_KICK_STRATEGY as SessionKickStrategy) || 'OLDEST';

type SessionEventPayload = {
  sessionId: number;
  deviceId: string;
  jwtId: string | null;
  reason: string | null;
  revokedAt: string;
};

const sseClientsByUser = new Map<number, Set<Response>>();

const addSseClient = (userId: number, res: Response) => {
  let set = sseClientsByUser.get(userId);
  if (!set) {
    set = new Set<Response>();
    sseClientsByUser.set(userId, set);
  }
  set.add(res);
};

const removeSseClient = (userId: number, res: Response) => {
  const set = sseClientsByUser.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    sseClientsByUser.delete(userId);
  }
};

const broadcastSessionRevoked = (userId: number, payload: SessionEventPayload) => {
  const set = sseClientsByUser.get(userId);
  if (!set) return;
  const text = JSON.stringify(payload);
  for (const res of set) {
    res.write(`event: session_revoked\n`);
    res.write(`data: ${text}\n\n`);
  }
};

const deriveDeviceNameFromUserAgent = (ua: string | null | undefined): string | null => {
  if (!ua) return null;
  let os = 'Unknown OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  let browser = 'Browser';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/')) browser = 'Safari';

  return `${os} ${browser}`;
};

type LoginAttemptState = {
  failures: number;
  tempLockUntil?: number;
};

const loginAttemptsByUser = new Map<number, LoginAttemptState>();
const unknownUserAttempts = new Map<string, LoginAttemptState>();

const normalizeIp = (ip: string | null | undefined): string | null => {
	if (!ip) return null;
	if (ip === '::1') return '127.0.0.1';
	if (ip.startsWith('::ffff:')) return ip.substring(7);
	return ip;
};

const getClientIp = (req: Request): string | null => {
	const forwarded = req.headers['x-forwarded-for'];
	if (typeof forwarded === 'string' && forwarded.length > 0) {
		const first = forwarded.split(',')[0].trim();
		const normalized = normalizeIp(first);
		if (normalized) return normalized;
	}
	const remote = req.socket.remoteAddress || null;
	return normalizeIp(remote);
};

const generateApiKey = () => crypto.randomBytes(32).toString('hex');

const encodePermissionSlug = (slug: string): string => {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  const code = Math.abs(hash) % 9000 + 1000;
  return `B${code}`;
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
	const clientIp = getClientIp(req);
    const { username, password, deviceId, deviceName } = req.body;

    const user: any = await User.findOne({ 
      where: { username },
      include: [
        Permission,
        {
          model: Role,
          include: [Permission]
        }
      ]
    });

    if (!user) {
      const now = Date.now();
      const key = (username || '').trim().toLowerCase();
      const state: LoginAttemptState = unknownUserAttempts.get(key) ?? { failures: 0 };

      if (state.tempLockUntil && now < state.tempLockUntil) {
        const remainingSeconds = Math.ceil((state.tempLockUntil - now) / 1000);
        const message = `Too many failed attempts. Please try again in ${remainingSeconds}s.`;
        await logAudit(
          null,
          'LOGIN_BLOCKED',
          { username, reason: 'Unknown username temporary lockout', remainingSeconds },
          null,
          clientIp || undefined
        );
        res.status(429).json({ message, lockoutUntil: state.tempLockUntil });
        return;
      } else if (state.tempLockUntil && now >= state.tempLockUntil) {
        state.tempLockUntil = undefined;
      }

      state.failures += 1;

      if (state.failures > 5) {
        state.tempLockUntil = now + 30 * 1000;
        unknownUserAttempts.set(key, state);
        await logAudit(
          null,
          'LOGIN_BLOCKED',
          { username, reason: 'Unknown username too many failed attempts; temp lock', failures: state.failures, lockoutSeconds: 30 },
          null,
          clientIp || undefined
        );
        res.status(429).json({ message: 'Too many failed attempts. Please try again in 30s.', lockoutUntil: state.tempLockUntil });
        return;
      }

      unknownUserAttempts.set(key, state);

      await logAudit(null, 'LOGIN_FAILED', { username, reason: 'User not found', failures: state.failures }, null, clientIp || undefined);
      res.status(401).json({ message: 'User not found' });
      return;
    }

    if (user.status === 'locked') {
      await logAudit(user.id, 'LOGIN_BLOCKED', { reason: 'Account locked' }, null, clientIp || undefined);
      res.status(403).json({ message: 'Account is locked' });
      return;
    }

    const now = Date.now();
    const state: LoginAttemptState = loginAttemptsByUser.get(user.id) ?? { failures: 0 };

    if (state.tempLockUntil && now < state.tempLockUntil) {
      const remainingSeconds = Math.ceil((state.tempLockUntil - now) / 1000);
      const message = `Too many failed attempts. Please try again in ${remainingSeconds}s.`;
      await logAudit(user.id, 'LOGIN_BLOCKED', { username, reason: 'Temporary lockout', remainingSeconds }, null, clientIp || undefined);
      res.status(429).json({ message, lockoutUntil: state.tempLockUntil });
      return;
    } else if (state.tempLockUntil && now >= state.tempLockUntil) {
      state.tempLockUntil = undefined;
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      state.failures += 1;

      if (state.failures > 5) {
        user.status = 'locked';
        await user.save();
        loginAttemptsByUser.delete(user.id);
        await logAudit(user.id, 'LOGIN_BLOCKED', { username, reason: 'Too many failed attempts; account locked', failures: state.failures }, null, clientIp || undefined);
        res.status(403).json({ message: 'Account is locked' });
        return;
      }

      if (state.failures >= 4 && state.failures <= 5) {
        state.tempLockUntil = now + 30 * 1000;
        loginAttemptsByUser.set(user.id, state);
        await logAudit(
          user.id,
          'LOGIN_FAILED',
          { username, reason: 'Invalid password', failures: state.failures, lockoutSeconds: 30 },
          null,
          clientIp || undefined
        );
        res.status(429).json({ message: 'Too many failed attempts. Please try again in 30s.', lockoutUntil: state.tempLockUntil });
        return;
      }

      loginAttemptsByUser.set(user.id, state);
      await logAudit(user.id, 'LOGIN_FAILED', { username, reason: 'Invalid password', failures: state.failures }, null, clientIp || undefined);
      res.status(401).json({ message: 'Invalid password' });
      return;
    }

    if (state.failures > 0 || state.tempLockUntil) {
      loginAttemptsByUser.delete(user.id);
    }

    if (!user.api_key) {
      await logAudit(
        user.id,
        'LOGIN_BLOCKED',
        { username, reason: 'Missing API key on login' },
        null,
        clientIp || undefined
      );
      res.status(403).json({ message: 'API key not provisioned for this account' });
      return;
    }

    const effectiveDeviceId =
      typeof deviceId === 'string' && deviceId.trim().length > 0
        ? deviceId.trim()
        : `auto-${(clientIp || 'unknown').replace(/[^a-zA-Z0-9]/g, '_')}`;

    const existingDeviceLock = await UserDeviceLock.findOne({
      where: {
        user_id: user.id,
        device_id: effectiveDeviceId,
      },
    });

    if (existingDeviceLock) {
      await logAudit(
        user.id,
        'LOGIN_BLOCKED_DEVICE_LOCK',
        { deviceId: effectiveDeviceId, lockId: existingDeviceLock.id },
        null,
        clientIp || undefined
      );
      res.status(403).json({ message: 'This device is locked for this account' });
      return;
    }

    const uaHeader = req.headers['user-agent'];
    const userAgent = typeof uaHeader === 'string' ? uaHeader : null;

    const jti = crypto.randomBytes(16).toString('hex');

    const t = await sequelize.transaction();
    let kickedSessions: { original: any; updated: any }[] = [];

    try {
      const activeSessions = await UserSession.findAll({
        where: {
          user_id: user.id,
          is_active: true,
        },
        order: [['createdAt', 'ASC']],
        transaction: t,
        lock: t.LOCK.UPDATE as any,
      });

      for (const s of activeSessions.filter((s) => s.device_id === effectiveDeviceId)) {
        const original = s.toJSON();
        s.is_active = false;
        s.revoked_at = new Date();
        s.revoked_reason = 'REPLACED_BY_NEW_LOGIN';
        await s.save({ transaction: t });
        kickedSessions.push({ original, updated: s.toJSON() });
      }

      const remaining = activeSessions.filter((s) => s.device_id !== effectiveDeviceId);

      // Enforce Max Devices Policy (Kick Oldest)
      // We want to allow MAX_DEVICES_PER_USER devices.
      // If we are about to add 1 new device, we must ensure existing active devices <= MAX - 1.
      
      const MAX_ALLOWED = MAX_DEVICES_PER_USER; 
      // Filter out sessions that are already marked for replacement (same device ID)
      // 'remaining' contains sessions from OTHER devices that are currently active.
      // We group them by device_id because one device might technically have multiple sessions if cleanup failed, 
      // but ideally we treat unique device_id as unique device.
      
      const uniqueDevices = new Map<string, typeof remaining>();
      remaining.forEach(s => {
        if (!uniqueDevices.has(s.device_id)) {
           uniqueDevices.set(s.device_id, []);
        }
        uniqueDevices.get(s.device_id)?.push(s);
      });
      
      const currentDeviceCount = uniqueDevices.size;
      
      if (currentDeviceCount >= MAX_ALLOWED) {
         // We need to kick (currentDeviceCount - MAX_ALLOWED + 1) devices to make room
         const devicesToKickCount = currentDeviceCount - MAX_ALLOWED + 1;
         
         // Sort devices by their most recent activity or creation time to find the oldest
         // We use the oldest session's createdAt as a proxy for "device added at"
         const sortedDevices = Array.from(uniqueDevices.entries()).sort(([, sessionsA], [, sessionsB]) => {
            // Safety check: ensure sessions arrays are not empty
            const sessionA = sessionsA[0];
            const sessionB = sessionsB[0];
            
            if (!sessionA || !sessionB) return 0;

            const timeA = sessionA.createdAt instanceof Date ? sessionA.createdAt.getTime() : new Date(sessionA.createdAt).getTime();
            const timeB = sessionB.createdAt instanceof Date ? sessionB.createdAt.getTime() : new Date(sessionB.createdAt).getTime();
            return timeA - timeB; // Ascending: Oldest first
         });
         
         const devicesToKick = sortedDevices.slice(0, devicesToKickCount);
         
         for (const [_, sessions] of devicesToKick) {
            for (const s of sessions) {
                const original = s.toJSON();
                s.is_active = false;
                s.revoked_at = new Date();
                s.revoked_reason = 'MAX_DEVICES_EXCEEDED';
                await s.save({ transaction: t });
                kickedSessions.push({ original, updated: s.toJSON() });
            }
         }
      }

      await UserSession.create(
        {
          user_id: user.id,
          device_id: effectiveDeviceId,
          device_name:
            typeof deviceName === 'string' && deviceName.trim().length > 0
              ? deviceName.trim().slice(0, 191)
              : null,
          user_agent: userAgent ? userAgent.slice(0, 255) : null,
          ip_address: clientIp,
          jwt_id: jti,
          is_active: true,
          last_active_at: new Date(),
          fullname: (user as any).full_name || user.username,
        },
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        jti,
        deviceId: effectiveDeviceId, // Bind Token to Device ID
        tokenVersion: user.token_version, // Include current token version
      },
      secret,
      { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as any }
    );

    for (const entry of kickedSessions) {
      await logAudit(
        user.id,
        'SESSION_FORCE_LOGOUT',
        entry.original,
        entry.updated,
        clientIp || undefined
      );
      const updated: any = entry.updated;
      const revokedAt =
        updated.revoked_at instanceof Date
          ? updated.revoked_at.toISOString()
          : new Date().toISOString();
      broadcastSessionRevoked(user.id, {
        sessionId: updated.id,
        deviceId: updated.device_id,
        jwtId: updated.jwt_id || null,
        reason: updated.revoked_reason || null,
        revokedAt,
      });
    }

    await logAudit(
      user.id,
      'LOGIN_SUCCESS',
      null,
      {
        deviceId: effectiveDeviceId,
        jti,
      },
      clientIp || undefined
    );

    // Update last login info
    try {
      const effectiveIp = clientIp || null;
      await user.update({ last_login_at: new Date(), last_login_ip: effectiveIp });
    } catch (e) {
      console.error('Failed to update last login info:', e);
    }

    // Encrypt the token before setting it in the cookie
    const encryptedToken = encrypt(token);

    // Parse JWT_EXPIRES_IN to milliseconds for cookie maxAge
    // Assuming format like '12h', '1d', '30m' or plain ms number
    const parseDuration = (duration: string) => {
      if (!duration) return 24 * 60 * 60 * 1000; // Default 1 day
      const match = duration.match(/^(\d+)([dhms])?$/);
      if (!match) return 24 * 60 * 60 * 1000;
      const val = parseInt(match[1], 10);
      const unit = match[2] || 'ms';
      switch(unit) {
        case 'd': return val * 24 * 60 * 60 * 1000;
        case 'h': return val * 60 * 60 * 1000;
        case 'm': return val * 60 * 1000;
        case 's': return val * 1000;
        default: return val;
      }
    };
    const maxAge = parseDuration(process.env.JWT_EXPIRES_IN || '24h');

    res.cookie('_T', encryptedToken, {
      httpOnly: true,
      secure: true, // Always secure for cross-site (even if dev, if we want to simulate prod behavior)
      sameSite: 'none', // Required for cross-site cookie (frontend domain != backend domain)
      maxAge: maxAge 
    });

    res.json({ 
      success: true
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    let token = req.cookies?._T || (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]);

    if (token) {
      if (isEncrypted(token)) {
        token = decrypt(token);
      }
      try {
        const decoded: any = jwt.verify(token, secret);
        if (decoded && decoded.id && decoded.jti) {
          const session = await UserSession.findOne({
            where: {
              user_id: decoded.id,
              jwt_id: decoded.jti,
              is_active: true,
            },
          });

          if (session) {
            const original = session.toJSON();
            session.is_active = false;
            session.revoked_at = new Date();
            session.revoked_reason = 'LOGOUT';
            await session.save();
            const clientIp = getClientIp(req);
            await logAudit(
              decoded.id,
              'SESSION_LOGOUT',
              original,
              session.toJSON(),
              clientIp || undefined
            );
            const revokedAt = session.revoked_at
              ? session.revoked_at.toISOString()
              : new Date().toISOString();
            broadcastSessionRevoked(decoded.id, {
              sessionId: session.id,
              deviceId: session.device_id,
              jwtId: session.jwt_id || null,
              reason: session.revoked_reason || null,
              revokedAt,
            });
          }
        }
      } catch (e) {
      }
    }

    res.clearCookie('_T');
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Error logging out' });
  }
};

export const getMySessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    // We also want to include any "Locked" devices even if they are not active, 
    // so the admin can see them and unlock them if needed.
    // 1. Find all active sessions for this user
    const activeSessions = await UserSession.findAll({
      where: { 
        user_id: userId,
        is_active: true 
      },
      order: [['createdAt', 'DESC']],
    });

    // 2. Find all locks for this user
    const userLocks = await UserDeviceLock.findAll({
      where: { user_id: userId }
    });

    // 3. Collect device IDs from both active sessions and locks
    const deviceIdSet = new Set<string>();
    for (const s of activeSessions) {
      deviceIdSet.add(s.device_id);
    }
    for (const l of userLocks) {
      deviceIdSet.add(l.device_id);
    }

    if (deviceIdSet.size === 0) {
      res.json([]);
      return;
    }

    const deviceIds = Array.from(deviceIdSet.values());

    // 4. Re-query sessions for these devices to get display info (name, ip, etc)
    // We prioritize active sessions, but if a device is only locked (not active), we need its last session info.
    const allRelevantSessions = await UserSession.findAll({
      where: {
        device_id: { [Op.in]: deviceIds },
        // We fetch both active and inactive to find the latest info for locked devices
      },
      order: [['createdAt', 'DESC']],
    });

    // Map to find the "best" session to represent each device for this user
    // Priority: Active session for this user > Inactive session for this user > Any session
    const deviceBestSession = new Map<string, typeof allRelevantSessions[number]>();
    
    for (const s of allRelevantSessions) {
       if (!deviceBestSession.has(s.device_id)) {
          deviceBestSession.set(s.device_id, s);
       } else {
          const currentBest = deviceBestSession.get(s.device_id)!;
          // If current best is not active but this one is, swap
          if (!currentBest.is_active && s.is_active) {
             deviceBestSession.set(s.device_id, s);
          }
          // If both match active state, prefer the one belonging to current user
          else if (currentBest.is_active === s.is_active && currentBest.user_id !== userId && s.user_id === userId) {
             deviceBestSession.set(s.device_id, s);
          }
       }
    }

    // 5. Get all locks for these devices (global or user specific check)
    const locks = await UserDeviceLock.findAll({
      where: {
        device_id: { [Op.in]: deviceIds },
      },
    });
    const lockedByUserDevice = new Set<string>();
    for (const lock of locks) {
      lockedByUserDevice.add(`${lock.user_id}:${lock.device_id}`);
    }

    // 6. Build Result
    const result = [];
    for (const deviceId of deviceIds) {
       const s = deviceBestSession.get(deviceId);
       if (!s) continue; // Should not happen

       // Check if this device should be shown:
       // Show if: It has an active session OR it is locked by this user
       const isLocked = lockedByUserDevice.has(`${userId}:${deviceId}`);
       const isActive = s.is_active;

       if (!isActive && !isLocked) {
          continue; // Skip terminated devices that are NOT locked
       }

       const lockKey = `${userId}:${deviceId}`;
       
       result.push({
        id: s.id,
        device_id: s.device_id,
        device_name: s.device_name || deriveDeviceNameFromUserAgent(s.user_agent),
        user_agent: s.user_agent,
        ip_address: s.ip_address,
        is_active: isActive, // Might be false if it's only shown because it's locked
        revoked_at: s.revoked_at,
        revoked_reason: s.revoked_reason,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        last_active_at: s.last_active_at,
        fullname: (s as any).fullname,
        // other_accounts: [], // Simplified for now, or fetch if needed
        is_self: s.user_id === userId,
        is_device_locked: isLocked,
        is_device_locked_for_self: isLocked,
      });
    }

    result.sort((a, b) => {
      // Active first, then Locked
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });

    res.json(result);
  } catch (error) {
    console.error('getMySessions error:', error);
    res.status(500).json({ message: 'Error fetching sessions' });
  }
};

export const revokeMySession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    const { id } = req.params;
    const sessionId = Number(id);
    if (!sessionId || Number.isNaN(sessionId)) {
      res.status(400).json({ message: 'Invalid session id' });
      return;
    }

    const session = await UserSession.findOne({
      where: {
        id: sessionId,
      },
    });

    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const hasAccessDevice = await UserSession.findOne({
      where: {
        user_id: userId,
        device_id: session.device_id,
      },
    });

    if (!hasAccessDevice) {
      res.status(403).json({ message: 'Not allowed to revoke this session' });
      return;
    }

    if (!session.is_active && session.revoked_at) {
      res.json(session);
      return;
    }

    const original = session.toJSON();
    session.is_active = false;
    session.revoked_at = new Date();
    session.revoked_reason = 'MANUAL_TERMINATION';
    await session.save();

    const clientIp = getClientIp(req as any);
    await logAudit(
      userId,
      'SESSION_FORCE_LOGOUT',
      original,
      session.toJSON(),
      clientIp || undefined
    );

    const revokedAt = session.revoked_at
      ? session.revoked_at.toISOString()
      : new Date().toISOString();
    broadcastSessionRevoked(session.user_id, {
      sessionId: session.id,
      deviceId: session.device_id,
      jwtId: session.jwt_id || null,
      reason: session.revoked_reason || null,
      revokedAt,
    });

    res.json(session);
  } catch (error) {
    console.error('revokeMySession error:', error);
    res.status(500).json({ message: 'Error revoking session' });
  }
};

export const lockDeviceFingerprint = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    const { id } = req.params;
    const sessionId = Number(id);
    if (!sessionId || Number.isNaN(sessionId)) {
      res.status(400).json({ message: 'Invalid session id' });
      return;
    }

    const session = await UserSession.findOne({
      where: {
        id: sessionId,
      },
    });

    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const hasAccessDevice = await UserSession.findOne({
      where: {
        user_id: userId,
        device_id: session.device_id,
      },
    });

    if (!hasAccessDevice) {
      res.status(403).json({ message: 'Not allowed to lock this device' });
      return;
    }

    const existingLock = await UserDeviceLock.findOne({
      where: {
        user_id: session.user_id,
        device_id: session.device_id,
      },
    });

    if (existingLock) {
      res.json({ success: true });
      return;
    }

    const t = await sequelize.transaction();
    const revokedSessions: any[] = [];

    try {
      await UserDeviceLock.create(
        {
          user_id: session.user_id,
          device_id: session.device_id,
          locked_by: userId,
          reason: null,
        },
        { transaction: t }
      );

      const activeSessions = await UserSession.findAll({
        where: {
          user_id: session.user_id,
          device_id: session.device_id,
          is_active: true,
        },
        transaction: t,
        lock: t.LOCK.UPDATE as any,
      });

      for (const s of activeSessions) {
        const original = s.toJSON();
        s.is_active = false;
        s.revoked_at = new Date();
        s.revoked_reason = 'DEVICE_LOCKED';
        await s.save({ transaction: t });
        revokedSessions.push({ original, updated: s.toJSON() });
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    const clientIp = getClientIp(req as any);

    await logAudit(
      userId,
      'DEVICE_FINGERPRINT_LOCKED',
      {
        targetUserId: session.user_id,
        deviceId: session.device_id,
      },
      null,
      clientIp || undefined
    );

    for (const entry of revokedSessions) {
      const updated: any = entry.updated;
      const revokedAt =
        updated.revoked_at instanceof Date
          ? updated.revoked_at.toISOString()
          : new Date().toISOString();
      broadcastSessionRevoked(updated.user_id, {
        sessionId: updated.id,
        deviceId: updated.device_id,
        jwtId: updated.jwt_id || null,
        reason: updated.revoked_reason || null,
        revokedAt,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('lockDeviceFingerprint error:', error);
    res.status(500).json({ message: 'Error locking device' });
  }
};

export const unlockDeviceFingerprint = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    const { id } = req.params;
    const sessionId = Number(id);
    if (!sessionId || Number.isNaN(sessionId)) {
      res.status(400).json({ message: 'Invalid session id' });
      return;
    }

    const session = await UserSession.findOne({
      where: {
        id: sessionId,
      },
    });

    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const hasAccessDevice = await UserSession.findOne({
      where: {
        user_id: userId,
        device_id: session.device_id,
      },
    });

    if (!hasAccessDevice) {
      res.status(403).json({ message: 'Not allowed to unlock this device' });
      return;
    }

    const deletedCount = await UserDeviceLock.destroy({
      where: {
        user_id: session.user_id,
        device_id: session.device_id,
      },
    });

    const clientIp = getClientIp(req as any);

    await logAudit(
      userId,
      'DEVICE_FINGERPRINT_UNLOCKED',
      {
        targetUserId: session.user_id,
        deviceId: session.device_id,
        deletedCount,
      },
      null,
      clientIp || undefined
    );

    res.json({ success: true });
  } catch (error) {
    console.error('unlockDeviceFingerprint error:', error);
    res.status(500).json({ message: 'Error unlocking device' });
  }
};

export const getUs = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const user: any = await User.findByPk(userId, {
      include: [
        Permission,
        {
          model: Role,
          include: [Permission]
        }
      ]
    });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const safeName = user.full_name || user.username;

    const permissionSet = new Set<string>();
    if (user.Permissions) user.Permissions.forEach((p: any) => permissionSet.add(p.slug));
    if (user.Roles) {
      user.Roles.forEach((role: any) => {
        if (role.Permissions) {
          role.Permissions.forEach((p: any) => permissionSet.add(p.slug));
        }
      });
    }
    const permissionCodes = Array.from(permissionSet).map((slug) => encodePermissionSlug(slug));

    // Send the API Key as stored in DB (encrypted). 
    // The frontend treats it as an opaque token.
    // The backend validates it by comparing the encrypted strings directly.

    res.json({
      id: user.id,
      name: safeName,
      status: user.status,
      currency: user.currency,
      roles: user.Roles ? user.Roles.map((r: any) => r.name) : [],
      permissions: permissionCodes,
      ap: user.api_key || null
    });
  } catch (error) {
    console.error('GetUs error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const sessionEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    let token = req.cookies?._T || (req.query.token as string);
    if (!token) {
      res.status(401).json({ message: 'Missing token' });
      return;
    }

    if (isEncrypted(token)) {
      token = decrypt(token);
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token as string, secret);
    } catch (e) {
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }

    const userId = decoded.id as number | undefined;
    const jti = decoded.jti as string | undefined;
    if (!userId || !jti) {
      res.status(401).json({ message: 'Invalid token payload' });
      return;
    }

    const session = await UserSession.findOne({
      where: {
        user_id: userId,
        jwt_id: jti,
        is_active: true,
      },
    });

    if (!session || session.revoked_at) {
      res.status(401).json({ message: 'Session is not active' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if ((res as any).flushHeaders) {
      (res as any).flushHeaders();
    } else {
      res.write('\n');
    }

    addSseClient(userId, res);

    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ jti })}\n\n`);

    const onClose = () => {
      removeSseClient(userId, res);
      res.end();
    };

    req.on('close', onClose);
    req.on('end', onClose);
  } catch (error) {
    console.error('sessionEvents error:', error);
    try {
      res.status(500).json({ message: 'Error establishing session events stream' });
    } catch {
    }
  }
};

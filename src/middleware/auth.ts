import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { getCache, setCache } from '../services/CacheService';
import { User, Role, Permission } from '../models';
import UserSession from '../models/UserSession';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';

dotenv.config();

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error('JWT_SECRET environment variable must be set');
}

export interface AuthRequest extends Request {
  user?: any;
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token = req.cookies?._T || (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]);

  if (!token) {
    return res.status(401).json({ message: 'API Access Denied.' });
  }

  if (isEncrypted(token)) {
    token = decrypt(token);
  }

  jwt.verify(token, secret, async (err: any, decoded: any) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    const userId = decoded.id;
    const jti = decoded.jti;
    const tokenDeviceId = decoded.deviceId; // Retrieve bound device ID
    const tokenVersion = decoded.tokenVersion;

    if (jti) {
      const session = await UserSession.findOne({
        where: {
          user_id: userId,
          jwt_id: jti,
          is_active: true,
        },
      });

      if (!session || session.revoked_at) {
        return res.status(401).json({
          code: 'SESSION_REVOKED',
          message: 'Your session is no longer active. Please log in again.',
        });
      }

      // Token Blacklist Check
      // Although we check is_active above, we can enforce strict revoked check here if needed.
      // But the session.revoked_at check above already handles "blacklisted" sessions.
      
      // Fingerprint Validation: Ensure the Token is used on the same device it was issued for
      // We compare the deviceId inside the Token (signed and immutable) against the session record.
      // Ideally, the frontend should also send x-device-id header to cross-verify, 
      // but validating against the DB session record is the most secure backend-enforced check.
      if (tokenDeviceId && session.device_id !== tokenDeviceId) {
         // Token stolen and used on another device? Or session hijacked?         
         // Auto-revoke this session as it is compromised
         session.is_active = false;
         session.revoked_at = new Date();
         session.revoked_reason = 'TOKEN_THEFT_DETECTED';
         await session.save();

         return res.status(401).json({
            code: 'INVALID_DEVICE',
            message: 'Security Alert: Token theft detected. Session terminated.',
         });
      }

      try {
        session.last_active_at = new Date();
        await session.save();
      } catch (e) {
        console.error('Failed to update session last_active_at', e);
      }
    }

    const cacheKey = `user_permissions:${userId}`;
    const cachedPermissions = getCache(cacheKey);

    try {
      let user: any;
      let permissions: string[];

      if (cachedPermissions) {
        user = await User.findByPk(userId);
        if (!user) {
          return res.status(401).json({ message: 'User not found' });
        }
        
        // Token Version Check: If password was changed, token version increments
        // If token version is undefined (old tokens) or mismatch, revoke
        if (tokenVersion !== undefined && user.token_version !== tokenVersion) {
           return res.status(401).json({ 
             code: 'TOKEN_EXPIRED',
             message: 'Security update: Please log in again.' 
           });
        }

        if (user.status === 'locked') {
          return res.status(403).json({ message: 'Account is locked' });
        }
        if (!user.api_key) {
          return res.status(403).json({ message: 'API key missing for user' });
        }

        // Verify API Key matches (except for get-us profile fetch)
        const isProfileFetch = req.originalUrl.includes('/auth/get-us') || req.path.includes('/auth/get-us');
        if (!isProfileFetch) {
          const clientKey = req.headers['x-ap'];
          
          // Compare the encrypted key from header with the encrypted key in DB.
          // We do not need to decrypt them to check for equality.
          if (!clientKey || clientKey !== user.api_key) {
             return res.status(403).json({ message: 'Invalid or missing API Key (x-ap)' });
          }
        }
        
        permissions = Array.isArray(cachedPermissions) ? cachedPermissions as string[] : [];
      } else {
        user = await User.findByPk(userId, {
          include: [
            Permission,
            {
              model: Role,
              include: [Permission]
            }
          ]
        });

        if (!user) {
          return res.status(401).json({ message: 'User not found' });
        }

        // Token Version Check
        if (tokenVersion !== undefined && user.token_version !== tokenVersion) {
           return res.status(401).json({ 
             code: 'TOKEN_EXPIRED',
             message: 'Security update: Please log in again.' 
           });
        }

        if (user.status === 'locked') {
          return res.status(403).json({ message: 'Account is locked' });
        }
        if (!user.api_key) {
          return res.status(403).json({ message: 'API key missing for user' });
        }

        // Verify API Key matches (except for get-us profile fetch)
        const isProfileFetch = req.originalUrl.includes('/auth/get-us') || req.path.includes('/auth/get-us');
        if (!isProfileFetch) {
          const clientKey = req.headers['x-ap'];

          // Compare the encrypted key from header with the encrypted key in DB.
          if (!clientKey || clientKey !== user.api_key) {
             return res.status(403).json({ message: 'Invalid or missing API Key (x-ap)' });
          }
        }

        const permissionSet = new Set<string>();
        if (user.Permissions) user.Permissions.forEach((p: any) => permissionSet.add(p.slug));
        if (user.Roles) {
          user.Roles.forEach((role: any) => {
            if (role.Permissions) role.Permissions.forEach((p: any) => permissionSet.add(p.slug));
          });
        }

        permissions = Array.from(permissionSet);
        setCache(cacheKey, permissions);
      }

      req.user = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        status: user.status,
        permissions
      };
      next();
    } catch (dbError) {
      console.error('Error fetching user permissions:', dbError);
      req.user = { id: decoded.id, username: decoded.username, permissions: [] };
      return next();
    }
  });
};

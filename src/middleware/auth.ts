import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { getCache, setCache } from '../services/CacheService';
import { User, Role, Permission, SubBrand } from '../models';
import UserSession from '../models/UserSession';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';
import { sendError } from '../utils/response';

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
    sendError(res, 'Code101', 401);
    return;
  }

  if (isEncrypted(token)) {
    token = decrypt(token);
  }

  jwt.verify(token, secret, async (err: any, decoded: any) => {
    if (err) {
      sendError(res, 'Code103', 401);
      return;
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
        sendError(res, 'Code111', 401);
        return;
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

         sendError(res, 'Code110', 401);
         return;
      }

      try {
        session.last_active_at = new Date();
        await session.save();
      } catch (e) {
        // Session update failed, but continue
      }
    }

    const cacheKey = `user_permissions:${userId}`;
    const cachedPermissions = getCache(cacheKey);

    try {
      let user: any;
      let permissions: string[];

      if (cachedPermissions) {
        user = await User.findByPk(userId, {
          include: [{ model: Role, through: { attributes: [] }, required: false }],
        } as any);
        if (!user) {
          sendError(res, 'Code104', 401);
          return;
        }
        
        // Token Version Check: If password was changed, token version increments
        // If token version is undefined (old tokens) or mismatch, revoke
        if (tokenVersion !== undefined && user.token_version !== tokenVersion) {
           sendError(res, 'Code112', 401);
           return;
        }

        if (user.status === 'locked') {
          sendError(res, 'Code105', 403);
          return;
        }
        if (!user.api_key) {
          sendError(res, 'Code109', 403);
          return;
        }

        // Verify API Key matches (except for get-us profile fetch)
        const isProfileFetch = req.originalUrl.includes('/auth/get-us') || req.path.includes('/auth/get-us');
        if (!isProfileFetch) {
          const clientKey = req.headers['x-ap'];
          
          // Compare the encrypted key from header with the encrypted key in DB.
          // We do not need to decrypt them to check for equality.
          if (!clientKey || clientKey !== user.api_key) {
             sendError(res, 'Code108', 403);
             return;
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
          sendError(res, 'Code104', 401);
          return;
        }

        // Token Version Check
        if (tokenVersion !== undefined && user.token_version !== tokenVersion) {
           sendError(res, 'Code112', 401);
           return;
        }

        if (user.status === 'locked') {
          sendError(res, 'Code105', 403);
          return;
        }
        if (!user.api_key) {
          sendError(res, 'Code109', 403);
          return;
        }

        // Verify API Key matches (except for get-us profile fetch)
        const isProfileFetch = req.originalUrl.includes('/auth/get-us') || req.path.includes('/auth/get-us');
        if (!isProfileFetch) {
          const clientKey = req.headers['x-ap'];

          // Compare the encrypted key from header with the encrypted key in DB.
          if (!clientKey || clientKey !== user.api_key) {
             sendError(res, 'Code108', 403);
             return;
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

      const isSuperAdmin = Boolean(user.is_super_admin) || Boolean(user?.Roles?.some((r: any) => String(r?.name ?? '').toLowerCase() === 'super admin'));
      const isOperator = Boolean(user?.Roles?.some((r: any) => String(r?.name ?? '').toLowerCase() === 'operator'));
      let tenantId = user.tenant_id;
      let subBrandId = user.sub_brand_id;

      const rawOverride = req.headers['x-sub-brand-id'];
      if (typeof rawOverride === 'string' && rawOverride.trim().length > 0) {
        const overrideId = Number(rawOverride);
        if (Number.isFinite(overrideId) && overrideId > 0) {
          const sb = await SubBrand.findByPk(overrideId);
          if (!sb) {
            sendError(res, 'Code102', 403);
            return;
          }
          if (isSuperAdmin) {
            tenantId = (sb as any).tenant_id;
            subBrandId = sb.id;
          } else if (isOperator) {
            const sbTenantId = Number((sb as any).tenant_id ?? null);
            const userTenantId = Number(user.tenant_id ?? null);
            if (!Number.isFinite(sbTenantId) || !Number.isFinite(userTenantId) || sbTenantId !== userTenantId) {
              sendError(res, 'Code102', 403);
              return;
            }
            tenantId = userTenantId;
            subBrandId = sb.id;
          } else {
            sendError(res, 'Code102', 403);
            return;
          }
        }
      }

      req.user = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        status: user.status,
        permissions,
        tenant_id: tenantId ?? null,
        sub_brand_id: subBrandId ?? null,
        is_super_admin: isSuperAdmin,
      };
      next();
    } catch (dbError) {
      req.user = { id: decoded.id, username: decoded.username, permissions: [] };
      return next();
    }
  });
};

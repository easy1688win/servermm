import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { getCache, setCache } from '../services/CacheService';
import { User, Role, Permission, SubBrand, UserTenant } from '../models';
import UserSession from '../models/UserSession';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';
import { sendError } from '../utils/response';
import { Op } from 'sequelize';

dotenv.config();

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error('JWT_SECRET environment variable must be set');
}

export interface AuthRequest extends Request {
  user?: any;
}

const parseOptionalId = (raw: any): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

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

    try {
      const baseUser: any = await User.findByPk(userId);
      if (!baseUser) {
        sendError(res, 'Code104', 401);
        return;
      }

      if (tokenVersion !== undefined && baseUser.token_version !== tokenVersion) {
        sendError(res, 'Code112', 401);
        return;
      }

      if (baseUser.status === 'locked') {
        sendError(res, 'Code105', 403);
        return;
      }
      if (!baseUser.api_key) {
        sendError(res, 'Code109', 403);
        return;
      }

      const isProfileFetch = req.originalUrl.includes('/auth/get-us') || req.path.includes('/auth/get-us');
      if (!isProfileFetch) {
        const clientKey = req.headers['x-ap'];
        if (!clientKey || clientKey !== baseUser.api_key) {
          sendError(res, 'Code108', 403);
          return;
        }
      }

      const baseTenantId = Number(baseUser.tenant_id ?? null);
      const baseSubBrandId = Number(baseUser.sub_brand_id ?? null);
      let effectiveTenantId: number | null = Number.isFinite(baseTenantId) && baseTenantId > 0 ? baseTenantId : null;
      let effectiveSubBrandId: number | null = Number.isFinite(baseSubBrandId) && baseSubBrandId > 0 ? baseSubBrandId : null;

      let overrideSubBrand: any = null;
      const rawOverride = req.headers['x-sub-brand-id'];
      if (typeof rawOverride === 'string' && rawOverride.trim().length > 0) {
        const overrideId = Number(rawOverride);
        if (Number.isFinite(overrideId) && overrideId > 0) {
          overrideSubBrand = await SubBrand.findByPk(overrideId);
          if (!overrideSubBrand) {
            sendError(res, 'Code102', 403);
            return;
          }
          const tid = Number((overrideSubBrand as any).tenant_id ?? null);
          effectiveTenantId = Number.isFinite(tid) && tid > 0 ? tid : null;
          effectiveSubBrandId = overrideSubBrand.id;
        }
      }

      if (!overrideSubBrand) {
        const isRolesRoute = String(req.baseUrl || '').startsWith('/roles') || String(req.path || '').startsWith('/roles');
        if (isRolesRoute) {
          const requestedTenantId = parseOptionalId((req.query as any)?.tenantId ?? (req.query as any)?.tenant_id);
          if (requestedTenantId && requestedTenantId !== effectiveTenantId) {
            if (Boolean(baseUser.is_super_admin)) {
              effectiveTenantId = requestedTenantId;
              effectiveSubBrandId = null;
            } else if (requestedTenantId === (Number.isFinite(baseTenantId) && baseTenantId > 0 ? baseTenantId : null)) {
              effectiveTenantId = requestedTenantId;
              effectiveSubBrandId = null;
            } else {
              const hasAgentRole = await Role.findOne({
                where: { name: 'Agent' } as any,
                include: [
                  {
                    model: User,
                    required: true,
                    where: { id: baseUser.id } as any,
                    through: { attributes: [] },
                  } as any,
                ],
              } as any);
              if (!hasAgentRole) {
                sendError(res, 'Code102', 403);
                return;
              }
              const managedRow = await UserTenant.findOne({
                where: { userId: baseUser.id, tenantId: requestedTenantId } as any,
                attributes: ['tenantId'],
              });
              if (!managedRow) {
                sendError(res, 'Code102', 403);
                return;
              }
              effectiveTenantId = requestedTenantId;
              effectiveSubBrandId = null;
            }
          }
        }
      }

      const roleWhere =
        effectiveTenantId != null
          ? { [Op.or]: [{ tenant_id: effectiveTenantId }, { tenant_id: null }] }
          : { tenant_id: null };

      const cacheKey = `user_permissions:v2:${userId}:${effectiveTenantId ?? 'null'}`;
      const cachedPermissions = getCache(cacheKey);

      let user: any;
      let permissions: string[];
      let managedTenantIdsForAgent: number[] | null = null;
      let hasAnyAgentRole: boolean | null = null;

      if (cachedPermissions) {
        user = await User.findByPk(userId, {
          include: [{ model: Role, through: { attributes: [] }, required: false, where: roleWhere }],
        } as any);
        if (!user) {
          sendError(res, 'Code104', 401);
          return;
        }
        permissions = Array.isArray(cachedPermissions) ? (cachedPermissions as string[]) : [];
      } else {
        user = await User.findByPk(userId, {
          include: [
            Permission,
            {
              model: Role,
              required: false,
              where: roleWhere,
              include: [Permission],
            },
          ],
        } as any);
        if (!user) {
          sendError(res, 'Code104', 401);
          return;
        }

        const permissionSet = new Set<string>();
        if (user.Permissions) user.Permissions.forEach((p: any) => permissionSet.add(p.slug));
        if (user.Roles) {
          user.Roles.forEach((role: any) => {
            const roleTenantId = role?.tenant_id ?? null;
            const roleNameLower = String(role?.name ?? '').toLowerCase();
            const allowRole =
              (roleTenantId != null && roleTenantId === effectiveTenantId) ||
              (roleTenantId == null && roleNameLower === 'super admin');
            if (!allowRole) return;
            if (role.Permissions) role.Permissions.forEach((p: any) => permissionSet.add(p.slug));
          });
        }

        if (!Boolean(baseUser.is_super_admin) && effectiveTenantId != null) {
          const agentRoleRow = await Role.findOne({
            where: { name: 'Agent' } as any,
            include: [
              {
                model: User,
                required: true,
                where: { id: baseUser.id } as any,
                through: { attributes: [] },
              } as any,
            ],
          } as any);
          hasAnyAgentRole = Boolean(agentRoleRow);
          if (hasAnyAgentRole) {
            const fallbackTenantId = Number(baseUser.tenant_id ?? null);
            const rows = await UserTenant.findAll({ where: { userId: baseUser.id }, attributes: ['tenantId'] });
            const managed = rows
              .map((r: any) => Number(r.tenantId))
              .filter((x: number) => Number.isFinite(x) && x > 0);
            if (Number.isFinite(fallbackTenantId) && fallbackTenantId > 0 && !managed.includes(fallbackTenantId)) {
              managed.push(fallbackTenantId);
            }
            managedTenantIdsForAgent = managed;
            if (managed.includes(effectiveTenantId)) {
              const tenantAgentRole: any = await Role.findOne({
                where: { tenant_id: effectiveTenantId, name: 'Agent' } as any,
                include: [Permission],
              } as any);
              if (tenantAgentRole?.Permissions) {
                (tenantAgentRole.Permissions as any[]).forEach((p: any) => permissionSet.add(p.slug));
              }
            }
          }
        }

        permissions = Array.from(permissionSet);
        setCache(cacheKey, permissions);
      }

      const isSuperAdmin =
        Boolean(baseUser.is_super_admin) ||
        Boolean(user?.Roles?.some((r: any) => String(r?.name ?? '').toLowerCase() === 'super admin'));
      const isOperator = Boolean(
        user?.Roles?.some((r: any) => r?.tenant_id === effectiveTenantId && String(r?.name ?? '').toLowerCase() === 'operator'),
      );
      let isAgent = Boolean(
        user?.Roles?.some((r: any) => r?.tenant_id === effectiveTenantId && String(r?.name ?? '').toLowerCase() === 'agent'),
      );
      if (!isSuperAdmin && !isAgent && effectiveTenantId != null) {
        if (hasAnyAgentRole == null) {
          const agentRoleRow = await Role.findOne({
            where: { name: 'Agent' } as any,
            include: [
              {
                model: User,
                required: true,
                where: { id: baseUser.id } as any,
                through: { attributes: [] },
              } as any,
            ],
          } as any);
          hasAnyAgentRole = Boolean(agentRoleRow);
        }
        if (hasAnyAgentRole) {
          if (!managedTenantIdsForAgent) {
            const fallbackTenantId = Number(baseUser.tenant_id ?? null);
            const rows = await UserTenant.findAll({ where: { userId: baseUser.id }, attributes: ['tenantId'] });
            const managed = rows
              .map((r: any) => Number(r.tenantId))
              .filter((x: number) => Number.isFinite(x) && x > 0);
            if (Number.isFinite(fallbackTenantId) && fallbackTenantId > 0 && !managed.includes(fallbackTenantId)) {
              managed.push(fallbackTenantId);
            }
            managedTenantIdsForAgent = managed;
          }
          if (managedTenantIdsForAgent.includes(effectiveTenantId)) {
            isAgent = true;
          }
        }
      }

      if (overrideSubBrand) {
        if (isSuperAdmin) {
        } else if (isOperator) {
          const sbTenantId = Number((overrideSubBrand as any).tenant_id ?? null);
          const userTenantId = Number(baseUser.tenant_id ?? null);
          if (!Number.isFinite(sbTenantId) || !Number.isFinite(userTenantId) || sbTenantId !== userTenantId) {
            sendError(res, 'Code102', 403);
            return;
          }
        } else if (isAgent) {
          const sbTenantId = Number((overrideSubBrand as any).tenant_id ?? null);
          const fallbackTenantId = Number(baseUser.tenant_id ?? null);
          if (!managedTenantIdsForAgent) {
            const rows = await UserTenant.findAll({ where: { userId: baseUser.id }, attributes: ['tenantId'] });
            const managed = rows
              .map((r: any) => Number(r.tenantId))
              .filter((x: number) => Number.isFinite(x) && x > 0);
            if (Number.isFinite(fallbackTenantId) && fallbackTenantId > 0 && !managed.includes(fallbackTenantId)) {
              managed.push(fallbackTenantId);
            }
            managedTenantIdsForAgent = managed;
          }
          if (!Number.isFinite(sbTenantId) || !managedTenantIdsForAgent.includes(sbTenantId)) {
            sendError(res, 'Code102', 403);
            return;
          }
        } else {
          sendError(res, 'Code102', 403);
          return;
        }
      }

      req.user = {
        id: baseUser.id,
        username: baseUser.username,
        full_name: baseUser.full_name,
        status: baseUser.status,
        permissions,
        tenant_id: effectiveTenantId ?? null,
        sub_brand_id: effectiveSubBrandId ?? null,
        is_super_admin: isSuperAdmin,
      };
      next();
    } catch (dbError) {
      req.user = { id: decoded.id, username: decoded.username, permissions: [] };
      return next();
    }
  });
};

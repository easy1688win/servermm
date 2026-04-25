import { Request, Response } from 'express';
import { User, Permission, Role, UserRole, UserPermission, Tenant, SubBrand, UserTenant } from '../models';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';
import { invalidateCache, invalidateUserPermissionsCache } from '../services/CacheService';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { sendSuccess, sendError } from '../utils/response';

const generateApiKey = () => crypto.randomBytes(32).toString('hex');

const maskIpForDisplay = (ip: string | null): string | null => {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  // If IPv4
  if (trimmed.includes('.') && !trimmed.includes(':')) {
    const parts = trimmed.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.***.***`;
    }
  }
  // If IPv6
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length > 2) {
      return `${parts[0]}:${parts[1]}:****:****:****:****:****:****`;
    }
  }
  return '***.***.***.***';
};

const getRoleFlags = (req: AuthRequest, requester: any) => {
  const roles = Array.isArray(requester?.Roles) ? requester.Roles : [];
  const isSuperAdmin =
    Boolean(req.user?.is_super_admin) ||
    roles.some((r: any) => String(r?.name ?? '').toLowerCase() === 'super admin');
  const isOperator = roles.some((r: any) => String(r?.name ?? '').toLowerCase() === 'operator');
  const isAgent = roles.some((r: any) => String(r?.name ?? '').toLowerCase() === 'agent');
  return { isSuperAdmin, isOperator, isAgent };
};

const getManagedTenantIdsForAgent = async (userId: number, fallbackTenantId?: unknown): Promise<number[]> => {
  const rows = await UserTenant.findAll({ where: { userId }, attributes: ['tenantId'] });
  const ids = rows
    .map((r: any) => Number(r.tenantId))
    .filter((x: number) => Number.isFinite(x) && x > 0);

  const fallback = Number(fallbackTenantId ?? null);
  if (Number.isFinite(fallback) && fallback > 0 && !ids.includes(fallback)) {
    ids.push(fallback);
  }
  return ids;
};

const parseOptionalId = (raw: any): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Determine requester role membership
    const requesterId = req.user?.id;
    const requester = await User.findByPk(requesterId, {
      include: [{ model: Role, through: { attributes: [] } }]
    });
    
    // Check if requester is Super Admin
    const { isSuperAdmin, isOperator, isAgent } = getRoleFlags(req, requester);
    
    // Check specific permissions
    const permissions = (req.user?.permissions || []) as string[];
    const canViewFullIp = permissions.includes('view:full_ip');
    const canViewSensitive = permissions.includes('view:sensitive_info');

    const requesterTenantId = (requester as any)?.tenant_id ?? req.user?.tenant_id ?? null;
    let whereClause: any = {};
    if (isSuperAdmin) {
      whereClause = {};
    } else if (isOperator && requesterTenantId) {
      whereClause = { tenant_id: requesterTenantId };
    } else if (isAgent && requesterId) {
      const ids = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
      if (ids.length === 0) {
        sendSuccess(res, 'Code1', []);
        return;
      }
      whereClause = { tenant_id: ids };
    } else {
      whereClause = { id: requesterId };
    }

    const requestedTenantId = parseOptionalId((req.query as any)?.tenantId ?? (req.query as any)?.tenant_id);
    const requestedSubBrandId = parseOptionalId((req.query as any)?.subBrandId ?? (req.query as any)?.sub_brand_id);

    if (requestedTenantId) {
      if (isSuperAdmin) {
        whereClause.tenant_id = requestedTenantId;
      } else if (isOperator) {
        const tid = Number(requesterTenantId ?? null);
        if (!Number.isFinite(tid) || tid <= 0 || tid !== requestedTenantId) {
          sendError(res, 'Code102', 403);
          return;
        }
        whereClause.tenant_id = requestedTenantId;
      } else if (isAgent && requesterId) {
        const ids = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
        if (!ids.includes(requestedTenantId)) {
          sendError(res, 'Code102', 403);
          return;
        }
        whereClause.tenant_id = requestedTenantId;
      }
    }

    if (requestedSubBrandId) {
      const sb: any = await SubBrand.findByPk(requestedSubBrandId);
      if (!sb) {
        sendError(res, 'Code607', 404);
        return;
      }
      const sbTenantId = Number(sb.tenant_id ?? null);
      if (requestedTenantId && sbTenantId !== requestedTenantId) {
        // If sub-brand does not belong to the requested tenant, 
        // return an empty user list instead of 403 to prevent UI blocking.
        // This can happen if frontend state is temporarily inconsistent.
        sendSuccess(res, 'Code1', []);
        return;
      }
      if (!isSuperAdmin) {
        if (isOperator) {
          const tid = Number(requesterTenantId ?? null);
          if (!Number.isFinite(tid) || tid <= 0 || sbTenantId !== tid) {
            sendError(res, 'Code102', 403);
            return;
          }
        } else if (isAgent && requesterId) {
          const ids = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
          if (!ids.includes(sbTenantId)) {
            sendError(res, 'Code102', 403);
            return;
          }
        }
      }
      whereClause.sub_brand_id = requestedSubBrandId;
    }

    const users = await User.findAll({
      where: whereClause,
      attributes: { exclude: ['password_hash'] },
      include: [
        {
          model: Role,
          through: { attributes: [] }
        },
        {
          model: Permission,
          through: { attributes: [] }
        },
        {
          model: SubBrand,
          attributes: ['id', 'tenant_id', 'code', 'name', 'status'],
          required: false,
        },
        {
          model: Tenant,
          attributes: ['id', 'prefix', 'name'],
          required: false,
        }
      ]
    });
    
    let visibleUsers = users;
    if (!isSuperAdmin) {
        visibleUsers = users.filter((u) => {
          if (u.id === requesterId) return true;
          return !u.Roles?.some((r: Role) => {
            const n = String(r.name).toLowerCase();
            if (n === 'super admin') return true;
            if (n === 'agent') return !isAgent;
            return false;
          });
        });
    }

    const formattedUsers = visibleUsers.map((user) => {
      const userTenantId = Number((user as any).tenant_id ?? null);
      const filteredRoles = Array.isArray(user.Roles)
        ? user.Roles.filter((r: any) => {
          const roleTenantIdRaw = (r as any)?.tenant_id;
          const roleTenantId = roleTenantIdRaw == null ? null : Number(roleTenantIdRaw);
          const roleNameLower = String((r as any)?.name ?? '').toLowerCase();
          if (Number.isFinite(userTenantId) && userTenantId > 0 && roleTenantId != null && Number.isFinite(roleTenantId) && roleTenantId > 0) {
            return roleTenantId === userTenantId;
          }
          return roleTenantId == null && roleNameLower === 'super admin';
        })
        : [];
      const roleNames = Array.from(new Set(filteredRoles.map((r: any) => r.name)));
      // Basic fields
      const base = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        status: user.status,
        currency: user.currency,
        roles: roleNames,
        permissions: user.Permissions ? user.Permissions.map((p: Permission) => p.slug) : [],
        two_factor_enabled: user.two_factor_enabled,
      };

      // Sensitive fields with masking
      let lastLoginTime: string | null = null;
      if (user.last_login_at) {
          lastLoginTime = user.last_login_at instanceof Date 
            ? user.last_login_at.toISOString() 
            : new Date(user.last_login_at).toISOString();
      }

      let lastLoginIp: string | null = null;
      if (canViewFullIp || isSuperAdmin || user.id === requesterId) {
          lastLoginIp = user.last_login_ip;
      } else {
          lastLoginIp = maskIpForDisplay(user.last_login_ip);
      }

      let apiKeyMask: string | null = null;
      if (user.api_key) {
        if (canViewSensitive || isSuperAdmin || user.id === requesterId) {
            apiKeyMask = user.api_key; // Or partial mask if we want to be stricter
        } else {
            apiKeyMask = '********************************';
        }
      }

      return {
          ...base,
          last_login_at: lastLoginTime,
          last_login_ip: lastLoginIp,
          api_key: apiKeyMask,
          tenant_id: (user as any).tenant_id ?? null,
          tenant_name: (user as any).Tenant?.name ?? null,
          tenant_prefix: (user as any).Tenant?.prefix ?? null,
          sub_brand_id: (user as any).sub_brand_id ?? null,
          sub_brand_name: (user as any).SubBrand?.name ?? null,
          sub_brand_code: (user as any).SubBrand?.code ?? null,
      };
    });

    sendSuccess(res, 'Code1', formattedUsers);
  } catch (error) {
    sendError(res, 'Code603', 500); // Internal server error
  }
};

export const getUsersContext = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Check if requester is Super Admin
    const requesterId = req.user?.id;
    const requester = await User.findByPk(requesterId, {
      include: [{ model: Role, through: { attributes: [] } }]
    });
    
    const { isSuperAdmin, isOperator, isAgent } = getRoleFlags(req, requester);

    const requestedTenantId = parseOptionalId((req.query as any)?.tenantId ?? (req.query as any)?.tenant_id);
    const requestedSubBrandId = parseOptionalId((req.query as any)?.subBrandId ?? (req.query as any)?.sub_brand_id);
    const requesterTenantId = (requester as any)?.tenant_id ?? req.user?.tenant_id ?? null;
    const scopeRoleTenantId = requestedTenantId ?? parseOptionalId(requesterTenantId) ?? parseOptionalId(req.user?.tenant_id);
    
    // Get roles with permission filtering
    let roles = await Role.findAll({
        where: scopeRoleTenantId
          ? (isSuperAdmin
            ? ({
              [Op.or]: [
                { tenant_id: scopeRoleTenantId },
                { tenant_id: null, name: 'Super Admin' },
              ],
            } as any)
            : ({ tenant_id: scopeRoleTenantId } as any))
          : ({ tenant_id: null } as any),
        include: [Permission]
    });
    
    // Filter roles: non-superadmin users cannot see Super Admin role
    if (!isSuperAdmin) {
        roles = roles.filter((role) => {
          if (role.name === 'Super Admin') return false;
          if (role.name === 'Agent') return isAgent;
          return true;
        });
    }
    
    const permissions = await Permission.findAll();
    
    // Also return users as part of the context since the frontend expects it
    // Or we should update the frontend to call getUsers separately. 
    // Looking at the previous code provided by user, getUsersContext returned users too.
    
    // Reuse logic from getUsers but without response sending
    const userPermissions = (req.user?.permissions || []) as string[];
    const canViewFullIp = userPermissions.includes('view:full_ip');
    const canViewSensitive = userPermissions.includes('view:sensitive_info');

    let whereClause: any = {};
    if (isSuperAdmin) {
      whereClause = {};
    } else if (isOperator && requesterTenantId) {
      whereClause = { tenant_id: requesterTenantId };
    } else if (isAgent && requesterId) {
      const ids = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
      whereClause = ids.length === 0 ? ({ id: requesterId } as any) : ({ tenant_id: ids } as any);
    } else {
      whereClause = { id: requesterId };
    }

    if (requestedTenantId) {
      if (isSuperAdmin) {
        whereClause.tenant_id = requestedTenantId;
      } else if (isOperator) {
        const tid = Number(requesterTenantId ?? null);
        if (!Number.isFinite(tid) || tid <= 0 || tid !== requestedTenantId) {
          sendError(res, 'Code102', 403);
          return;
        }
        whereClause.tenant_id = requestedTenantId;
      } else if (isAgent && requesterId) {
        const ids = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
        if (!ids.includes(requestedTenantId)) {
          sendError(res, 'Code102', 403);
          return;
        }
        whereClause.tenant_id = requestedTenantId;
      }
    }

    if (requestedSubBrandId) {
      const sb: any = await SubBrand.findByPk(requestedSubBrandId);
      if (!sb) {
        sendError(res, 'Code607', 404);
        return;
      }
      const sbTenantId = Number(sb.tenant_id ?? null);
      if (requestedTenantId && sbTenantId !== requestedTenantId) {
        // If sub-brand does not belong to the requested tenant, 
        // return empty data instead of 403 to prevent UI blocking.
        sendSuccess(res, 'Code1', { roles: [], permissions: [], users: [], tenants: [], subBrands: [] });
        return;
      }
      if (!isSuperAdmin) {
        if (isOperator) {
          const tid = Number(requesterTenantId ?? null);
          if (!Number.isFinite(tid) || tid <= 0 || sbTenantId !== tid) {
            sendError(res, 'Code102', 403);
            return;
          }
        } else if (isAgent && requesterId) {
          const ids = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
          if (!ids.includes(sbTenantId)) {
            sendError(res, 'Code102', 403);
            return;
          }
        }
      }
      whereClause.sub_brand_id = requestedSubBrandId;
    }

    const users = await User.findAll({
      where: whereClause,
      attributes: { exclude: ['password_hash'] },
      include: [
        {
          model: Role,
          through: { attributes: [] }
        },
        {
          model: Permission,
          through: { attributes: [] }
        },
        {
          model: SubBrand,
          attributes: ['id', 'tenant_id', 'code', 'name', 'status'],
          required: false,
        },
        {
          model: Tenant,
          attributes: ['id', 'prefix', 'name'],
          required: false,
        }
      ]
    });

    let visibleUsers = users;
    if (!isSuperAdmin) {
        visibleUsers = users.filter((u) => {
          if (u.id === requesterId) return true;
          return !u.Roles?.some((r: Role) => {
            const n = String(r.name).toLowerCase();
            if (n === 'super admin') return true;
            if (n === 'agent') return !isAgent;
            return false;
          });
        });
    }

    const formattedUsers = visibleUsers.map((user) => {
      const userTenantId = Number((user as any).tenant_id ?? null);
      const filteredRoles = Array.isArray(user.Roles)
        ? user.Roles.filter((r: any) => {
          const roleTenantIdRaw = (r as any)?.tenant_id;
          const roleTenantId = roleTenantIdRaw == null ? null : Number(roleTenantIdRaw);
          const roleNameLower = String((r as any)?.name ?? '').toLowerCase();
          if (Number.isFinite(userTenantId) && userTenantId > 0 && roleTenantId != null && Number.isFinite(roleTenantId) && roleTenantId > 0) {
            return roleTenantId === userTenantId;
          }
          return roleTenantId == null && roleNameLower === 'super admin';
        })
        : [];
      const roleNames = Array.from(new Set(filteredRoles.map((r: any) => r.name)));
      const base = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        status: user.status,
        currency: user.currency,
        roles: roleNames,
        permissions: user.Permissions ? user.Permissions.map((p: Permission) => p.slug) : [],
        two_factor_enabled: user.two_factor_enabled,
      };

      let lastLoginTime: string | null = null;
      if (user.last_login_at) {
          lastLoginTime = user.last_login_at instanceof Date 
            ? user.last_login_at.toISOString() 
            : new Date(user.last_login_at).toISOString();
      }

      let lastLoginIp: string | null = null;
      if (canViewFullIp || isSuperAdmin || user.id === requesterId) {
          lastLoginIp = user.last_login_ip;
      } else {
          lastLoginIp = maskIpForDisplay(user.last_login_ip);
      }

      let apiKeyMask: string | null = null;
      if (user.api_key) {
        if (canViewSensitive || isSuperAdmin || user.id === requesterId) {
            apiKeyMask = user.api_key;
        } else {
            apiKeyMask = '********************************';
        }
      }

      return {
          ...base,
          lastLoginTime: lastLoginTime,
          lastLoginIp: lastLoginIp,
          apiKeyMask: apiKeyMask,
          twoFactorEnabled: user.two_factor_enabled,
          tenant_id: (user as any).tenant_id ?? null,
          tenant_name: (user as any).Tenant?.name ?? null,
          tenant_prefix: (user as any).Tenant?.prefix ?? null,
          sub_brand_id: (user as any).sub_brand_id ?? null,
          sub_brand_name: (user as any).SubBrand?.name ?? null,
          sub_brand_code: (user as any).SubBrand?.code ?? null,
      };
    });

    let tenants: any[] = [];
    let subBrands: any[] = [];
    if (isSuperAdmin) {
      [tenants, subBrands] = await Promise.all([
        Tenant.findAll({ order: [['id', 'ASC']] }),
        SubBrand.findAll({ order: [['id', 'ASC']] }),
      ]);
    } else if (isOperator) {
      const tid = Number((requester as any)?.tenant_id ?? req.user?.tenant_id ?? null);
      if (Number.isFinite(tid) && tid > 0) {
        [tenants, subBrands] = await Promise.all([
          Tenant.findAll({ where: { id: tid } as any, order: [['id', 'ASC']] }),
          SubBrand.findAll({ where: { tenant_id: tid } as any, order: [['id', 'ASC']] }),
        ]);
      }
    } else if (isAgent && requesterId) {
      const ids = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
      if (ids.length > 0) {
        [tenants, subBrands] = await Promise.all([
          Tenant.findAll({ where: { id: ids } as any, order: [['id', 'ASC']] }),
          SubBrand.findAll({ where: { tenant_id: ids } as any, order: [['id', 'ASC']] }),
        ]);
      }
    }

    sendSuccess(res, 'Code1', { roles, permissions, users: formattedUsers, tenants, subBrands });
  } catch (error) {
    sendError(res, 'Code603', 500); // Internal server error
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, password, full_name, fullName, roles, permissions, currency, sub_brand_id, subBrandId, subBrandCode, prefix } = req.body;
    
    // Check if requester is Super Admin
    const requesterId = req.user?.id;
    const requester = await User.findByPk(requesterId, {
      include: [{ model: Role, through: { attributes: [] } }]
    });
    
    const isSuperAdmin =
      Boolean(req.user?.is_super_admin) ||
      Boolean(requester?.Roles?.some((r: Role) => String(r.name).toLowerCase() === 'super admin'));
    const isOperator = Boolean(requester?.Roles?.some((r: Role) => String(r.name).toLowerCase() === 'operator'));
    const isAgent = Boolean(requester?.Roles?.some((r: Role) => String(r.name).toLowerCase() === 'agent'));
    
    // Validate roles: non-superadmin users cannot assign Super Admin role
    if (roles && Array.isArray(roles)) {
        if (!isSuperAdmin && roles.includes('Super Admin')) {
            sendError(res, 'Code604', 403); // Access denied: Cannot assign Super Admin role
            return;
        }
        if (!isSuperAdmin && !isAgent && roles.includes('Agent')) {
            sendError(res, 'Code604', 403); // Access denied: Cannot assign Agent role
            return;
        }
    }

    let resolvedSubBrand: any = null;
    if (isSuperAdmin) {
      const rawId = sub_brand_id ?? subBrandId ?? null;
      const nextId = rawId !== null && rawId !== undefined ? Number(rawId) : null;
      const code = typeof (subBrandCode ?? prefix) === 'string' ? String(subBrandCode ?? prefix).trim() : '';

      if (nextId && Number.isFinite(nextId) && nextId > 0) {
        resolvedSubBrand = await SubBrand.findByPk(nextId);
      } else if (code) {
        resolvedSubBrand = await SubBrand.findOne({ where: { code } as any });
      }

      if (!resolvedSubBrand) {
        sendError(res, 'Code1216', 400);
        return;
      }
    } else {
      const requesterTenantId = Number((requester as any)?.tenant_id ?? req.user?.tenant_id ?? null);
      const requestedSubBrandIdRaw = sub_brand_id ?? subBrandId ?? null;
      const requestedSubBrandId =
        requestedSubBrandIdRaw !== null && requestedSubBrandIdRaw !== undefined ? Number(requestedSubBrandIdRaw) : null;

      if (isOperator) {
        const pickId =
          requestedSubBrandId && Number.isFinite(requestedSubBrandId) && requestedSubBrandId > 0
            ? requestedSubBrandId
            : Number(req.user?.sub_brand_id ?? null);
        if (!Number.isFinite(pickId) || pickId <= 0) {
          sendError(res, 'Code102', 403);
          return;
        }
        resolvedSubBrand = await SubBrand.findByPk(pickId);
        if (!resolvedSubBrand) {
          sendError(res, 'Code102', 403);
          return;
        }
        const sbTenantId = Number((resolvedSubBrand as any).tenant_id ?? null);
        if (!Number.isFinite(requesterTenantId) || requesterTenantId <= 0 || sbTenantId !== requesterTenantId) {
          sendError(res, 'Code102', 403);
          return;
        }
      } else if (isAgent) {
        const rawId = requestedSubBrandIdRaw ?? null;
        const nextId = rawId !== null && rawId !== undefined ? Number(rawId) : null;
        if (!nextId || !Number.isFinite(nextId) || nextId <= 0) {
          sendError(res, 'Code102', 403);
          return;
        }
        resolvedSubBrand = await SubBrand.findByPk(nextId);
        if (!resolvedSubBrand) {
          sendError(res, 'Code102', 403);
          return;
        }
        const sbTenantId = Number((resolvedSubBrand as any).tenant_id ?? null);
        const managed = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
        if (!Number.isFinite(sbTenantId) || !managed.includes(sbTenantId)) {
          sendError(res, 'Code102', 403);
          return;
        }
      } else {
        const scopeSubBrandId = Number(req.user?.sub_brand_id ?? null);
        if (!Number.isFinite(scopeSubBrandId) || scopeSubBrandId <= 0) {
          sendError(res, 'Code102', 403);
          return;
        }
        resolvedSubBrand = await SubBrand.findByPk(scopeSubBrandId);
        if (!resolvedSubBrand) {
          sendError(res, 'Code102', 403);
          return;
        }
      }
    }

    const usernameRaw = typeof username === 'string' ? username : String(username ?? '');
    const passwordRaw = typeof password === 'string' ? password : String(password ?? '');
    const trimmedUsername = usernameRaw.trim();

    if (!trimmedUsername || !passwordRaw) {
      sendError(res, 'Code602', 400, { detail: 'user_mgmt_username_and_password_required' });
      return;
    }

    const usernameOk = /^[A-Za-z0-9._]+$/.test(trimmedUsername);
    if (usernameRaw !== trimmedUsername || !usernameOk) {
      sendError(res, 'Code602', 400, { detail: 'user_mgmt_username_invalid' });
      return;
    }

    const existing = await User.findOne({ where: { username: trimmedUsername } as any });
    if (existing) {
        sendError(res, 'Code605', 400); // Username already exists
        return;
    }

    const password_hash = await bcrypt.hash(passwordRaw, 10);
    const effectiveFullName = full_name ?? fullName;
    
    const user = await User.create({
        username: trimmedUsername,
        password_hash,
        full_name: effectiveFullName,
        currency: currency || 'USD',
        status: 'active',
        token_version: 0,
        api_key: generateApiKey(),
        tenant_id: (resolvedSubBrand as any).tenant_id,
        sub_brand_id: resolvedSubBrand.id,
    });

    if (roles && Array.isArray(roles)) {
        const targetTenantId = Number((resolvedSubBrand as any).tenant_id ?? null);
        const roleNames = roles.map((r: any) => String(r)).filter((r: string) => r.trim().length > 0);
        const wantsSuperAdmin = roleNames.some((r: string) => r.toLowerCase() === 'super admin');
        const tenantRoleNames = roleNames.filter((r: string) => r.toLowerCase() !== 'super admin');

        const roleObjects: any[] = [];
        if (tenantRoleNames.length > 0) {
          const tenantRoles = await Role.findAll({
            where: {
              tenant_id: targetTenantId,
              name: { [Op.in]: tenantRoleNames },
            } as any,
          });
          roleObjects.push(...(tenantRoles as any[]));
        }
        if (wantsSuperAdmin && isSuperAdmin) {
          const superAdminRole = await Role.findOne({ where: { tenant_id: null, name: 'Super Admin' } as any });
          if (superAdminRole) roleObjects.push(superAdminRole as any);
        }

        for (const role of roleObjects) {
          await UserRole.findOrCreate({ where: { userId: user.id, roleId: role.id } as any });
        }
    }

    if (permissions && Array.isArray(permissions)) {
        const permObjects = await Permission.findAll({
             where: {
                 slug: {
                     [Op.in]: permissions
                 }
             }
        });
        
        for (const perm of permObjects) {
            await UserPermission.create({ userId: user.id, permissionId: perm.id });
        }
    }

    await logAudit(req.user?.id, 'USER_CREATE', null, { username, roles }, getClientIp(req));

    sendSuccess(res, 'Code600', user, undefined, 201); // User created
  } catch (error) {
    sendError(res, 'Code603', 500); // Internal server error
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    // Map frontend payload keys to what we need
    // Frontend sends: username, fullName, status, roles (array of strings), password
    const { username, password, full_name, fullName, roles, permissions, status, currency, sub_brand_id, subBrandId } = req.body;
    
    // Check if requester is Super Admin
    const requesterId = req.user?.id;
    const requester = await User.findByPk(requesterId, {
      include: [{ model: Role, through: { attributes: [] } }]
    });
    
    const isSuperAdmin =
      Boolean(req.user?.is_super_admin) ||
      Boolean(requester?.Roles?.some((r: Role) => String(r.name).toLowerCase() === 'super admin'));
    const isAgent = Boolean(requester?.Roles?.some((r: Role) => String(r.name).toLowerCase() === 'agent'));
    const requesterTenantId = (requester as any)?.tenant_id ?? req.user?.tenant_id ?? null;
    
    // Validate roles: non-superadmin users cannot assign Super Admin role
    if (roles && Array.isArray(roles)) {
        if (!isSuperAdmin && roles.includes('Super Admin')) {
            sendError(res, 'Code604', 403); // Access denied: Cannot assign Super Admin role
            return;
        }
        if (!isSuperAdmin && roles.includes('Agent')) {
            sendError(res, 'Code604', 403); // Access denied: Cannot assign Agent role
            return;
        }
    }
    
    const userId = Number(id);
    if (isNaN(userId)) {
        sendError(res, 'Code606', 400); // Invalid user ID
        return;
    }

    const user = await User.findByPk(userId);
    if (!user) {
        sendError(res, 'Code607', 404); // User not found
        return;
    }

    if (!isSuperAdmin && isAgent && requesterId && userId !== requesterId) {
      const managed = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
      const targetTenantId = Number((user as any).tenant_id ?? null);
      if (!Number.isFinite(targetTenantId) || !managed.includes(targetTenantId)) {
        sendError(res, 'Code102', 403);
        return;
      }
    }

    const original = user.toJSON();
    const originalTenantId = Number((original as any)?.tenant_id ?? null);

    //禁止修改username - 用户名是核心身份标识
    if (username !== undefined && username !== user.username) {
      sendError(res, 'Code610', 400); // Username cannot be modified
      return;
    }

    if (password) {
        user.password_hash = await bcrypt.hash(password, 10);
        user.token_version += 1; // Invalidate sessions
    }
    
    const effectiveFullName = full_name ?? fullName;
    if (effectiveFullName !== undefined) user.full_name = effectiveFullName;
    
    if (status !== undefined) {
        user.status = status;
        if (status === 'locked' || status === 'banned') {
            user.token_version += 1;
        }
    }
    if (currency !== undefined) user.currency = currency;

    const targetSubBrandRaw = sub_brand_id ?? subBrandId;
    if (targetSubBrandRaw !== undefined) {
      if (!isSuperAdmin && !isAgent) {
        sendError(res, 'Code102', 403);
        return;
      }
      const nextSubBrandId = Number(targetSubBrandRaw);
      if (!Number.isFinite(nextSubBrandId) || nextSubBrandId <= 0) {
        sendError(res, 'Code1215', 400);
        return;
      }
      const sb = await SubBrand.findByPk(nextSubBrandId);
      if (!sb) {
        sendError(res, 'Code1216', 404);
        return;
      }
      if (!isSuperAdmin && isAgent && requesterId) {
        const managed = await getManagedTenantIdsForAgent(Number(requesterId), requesterTenantId);
        const sbTenantId = Number((sb as any).tenant_id ?? null);
        if (!Number.isFinite(sbTenantId) || !managed.includes(sbTenantId)) {
          sendError(res, 'Code102', 403);
          return;
        }
      }
      (user as any).sub_brand_id = sb.id;
      (user as any).tenant_id = (sb as any).tenant_id;
    }

    await user.save();

    // 角色修改策略：
    // - 仅 Super Admin 可以修改角色
    // - 非 Super Admin 如果前端传了 roles，直接忽略，不报错，保证资料更新可成功
    if (roles !== undefined) {
      if (isSuperAdmin) {
        if (Array.isArray(roles)) {
          // Super Admin 不得将目标用户设置为 Super Admin 以外？这里允许 Super Admin 完整管理
          const targetTenantId = Number((user as any).tenant_id ?? null);
          const roleNames = roles.map((r: any) => String(r)).filter((r: string) => r.trim().length > 0);
          const wantsSuperAdmin = roleNames.some((r: string) => r.toLowerCase() === 'super admin');
          const tenantRoleNames = roleNames.filter((r: string) => r.toLowerCase() !== 'super admin');

          const roleObjects: any[] = [];
          if (tenantRoleNames.length > 0) {
            const tenantRoles = await Role.findAll({
              where: { tenant_id: targetTenantId, name: { [Op.in]: tenantRoleNames } } as any,
            });
            roleObjects.push(...(tenantRoles as any[]));
          }
          if (wantsSuperAdmin) {
            const superAdminRole = await Role.findOne({ where: { tenant_id: null, name: 'Super Admin' } as any });
            if (superAdminRole) roleObjects.push(superAdminRole as any);
          }

          await UserRole.destroy({ where: { userId: user.id } });
          for (const role of roleObjects) {
            await UserRole.findOrCreate({ where: { userId: user.id, roleId: role.id } as any });
          }

          invalidateUserPermissionsCache(user.id);
        }
      } else {
        // 非 Super Admin：忽略 roles 字段
      }
    }

    // Update Permissions (Input is array of Permission Slugs)
    if (permissions && Array.isArray(permissions)) {
        const permObjects = await Permission.findAll({
             where: {
                 slug: {
                     [Op.in]: permissions
                 }
             }
        });

        await UserPermission.destroy({ where: { userId: user.id } });
        
        for (const perm of permObjects) {
            await UserPermission.create({ userId: user.id, permissionId: perm.id });
        }
        invalidateUserPermissionsCache(user.id);
    }

    await logAudit(req.user?.id, 'USER_UPDATE', original, req.body, getClientIp(req));

    sendSuccess(res, 'Code601', user); // User updated
  } catch (error) {
    sendError(res, 'Code603', 500); // Internal server error
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = Number(id);
    if (isNaN(userId)) {
        sendError(res, 'Code606', 400); // Invalid user ID
        return;
    }

    const user = await User.findByPk(userId);
    
    if (!user) {
        sendError(res, 'Code607', 404); // User not found
        return;
    }
    
    // Prevent deleting self or super admin if not allowed (logic can be complex, keeping simple)
    
    const original = user.toJSON();
    await user.destroy();
    
    await logAudit(req.user?.id, 'USER_DELETE', original, null, getClientIp(req));

    sendSuccess(res, 'Code602'); // User deleted
  } catch (error) {
    sendError(res, 'Code603', 500); // Internal server error
  }
};

export const rotateUserApiKey = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const userId = Number(id);
        if (isNaN(userId)) {
            sendError(res, 'Code606', 400); // Invalid user ID
            return;
        }

        const user = await User.findByPk(userId);
        
        if (!user) {
            sendError(res, 'Code607', 404); // User not found
            return;
        }

        const newKey = generateApiKey();
        user.api_key = newKey; // Will be encrypted by hook
        await user.save();

        await logAudit(req.user?.id, 'API_KEY_ROTATE', { userId: id }, null, getClientIp(req));

        sendSuccess(res, 'Code1', { apiKey: newKey }); // Re-use generic Code1 for rotate API key success, not in mapping specifically
    } catch (error) {
        sendError(res, 'Code603', 500); // Internal server error
    }
};

export const reset2FA = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const targetUserId = Number(id);
        const requesterId = req.user?.id;
        
        if (!targetUserId || Number.isNaN(targetUserId)) {
             sendError(res, 'Code608', 400); // Invalid user id
             return;
        }

        const user = await User.findByPk(targetUserId);
        if (!user) {
             sendError(res, 'Code607', 404); // User not found
             return;
        }

        user.two_factor_secret = null;
        user.two_factor_enabled = false;
        await user.save();
        
        // Invalidate any setup cache
        invalidateCache(`2fa_setup_secret:${user.id}`);

        await logAudit(requesterId, 'TWOFA_RESET', { targetUserId: user.id, targetUsername: user.username }, null, getClientIp(req));

        sendSuccess(res, 'Code609'); // 2FA reset successfully
    } catch (error) {
        sendError(res, 'Code603', 500); // Internal server error
    }
};

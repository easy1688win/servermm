import { Response } from 'express';
import { Role, Permission, User } from '../models';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';
import { flushCache } from '../services/CacheService';
import { sendSuccess, sendError } from '../utils/response';
import { RESERVED_ROLE_NAMES, normalizeRoleName } from '../constants/systemRoles';
import { Op } from 'sequelize';

const parseOptionalId = (raw: any): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

const getScopeTenantId = (req: AuthRequest, isSuperAdmin: boolean): number | null => {
  if (isSuperAdmin) {
    return parseOptionalId((req.query as any)?.tenantId ?? (req.query as any)?.tenant_id ?? (req.user as any)?.tenant_id);
  }
  return parseOptionalId((req.user as any)?.tenant_id);
};

const isProtectedSystemRoleName = (name: unknown): boolean => {
  const lower = normalizeRoleName(name).toLowerCase();
  return lower === 'viewer' || RESERVED_ROLE_NAMES.has(lower);
};

const isSensitiveRoleName = (name: unknown): boolean => {
  const raw = normalizeRoleName(name);
  const lower = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!lower) return false;

  const patterns: RegExp[] = [
    /\bsuper\s*admin\b/i,
    /\bsuperadmin\b/i,
    /\bsystem\s*admin\b/i,
    /\bsysadmin\b/i,
    /\badministrator\b/i,
    /\bsuperuser\b/i,
    /\boperator\b/i,
    /\bagent\b/i,
    /\broot\b/i,
    /\bowner\b/i,
    /\bgod\b/i,
  ];
  return patterns.some((re) => re.test(lower));
};

const getRequesterRoleFlags = async (
  req: AuthRequest,
): Promise<{ isSuperAdmin: boolean; isAgent: boolean }> => {
  if (!req.user?.id) return { isSuperAdmin: false, isAgent: false };
  if (Boolean(req.user?.is_super_admin)) return { isSuperAdmin: true, isAgent: false };

  const requester: any = await User.findByPk(req.user.id, {
    include: [{ model: Role, through: { attributes: [] } }],
  });
  const roles = Array.isArray(requester?.Roles) ? requester.Roles : [];
  const isSuperAdmin = roles.some((r: any) => String(r?.name ?? '').toLowerCase() === 'super admin');
  const isAgent = roles.some((r: any) => String(r?.name ?? '').toLowerCase() === 'agent');
  return { isSuperAdmin, isAgent };
};

const isRequesterSuperAdmin = async (req: AuthRequest): Promise<boolean> => {
  return (await getRequesterRoleFlags(req)).isSuperAdmin;
};

export const getRoleNames = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isSuperAdmin = await isRequesterSuperAdmin(req);
    const tenantId = getScopeTenantId(req, isSuperAdmin);
    if (!isSuperAdmin && !tenantId) {
      sendError(res, 'Code102', 403);
      return;
    }

    const roles = await Role.findAll({
      where: tenantId
        ? (isSuperAdmin
          ? ({
            [Op.or]: [
              { tenant_id: tenantId },
              { tenant_id: null, name: 'Super Admin' },
            ],
          } as any)
          : ({ tenant_id: tenantId } as any))
        : ({ tenant_id: null } as any),
      attributes: ['id', 'name', 'description', 'isSystem'],
      order: [
        ['isSystem', 'DESC'],
        ['name', 'ASC'],
      ],
    });

    const formatted = roles
      .map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
      }))
      .filter((r: any) => {
        if (isSuperAdmin) return true;
        const name = String(r.name ?? '').toLowerCase();
        return name !== 'super admin' && name !== 'agent';
      });

    sendSuccess(res, 'Code1', formatted);
  } catch (error) {
    sendError(res, 'Code1100', 500);
  }
};

export const getAllRoles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isSuperAdmin = await isRequesterSuperAdmin(req);
    const tenantId = getScopeTenantId(req, isSuperAdmin);
    if (!isSuperAdmin && !tenantId) {
      sendError(res, 'Code102', 403);
      return;
    }

    const roles = await Role.findAll({
      where: tenantId
        ? (isSuperAdmin
          ? ({
            [Op.or]: [
              { tenant_id: tenantId },
              { tenant_id: null, name: 'Super Admin' },
            ],
          } as any)
          : ({ tenant_id: tenantId } as any))
        : ({ tenant_id: null } as any),
      include: [
        {
          model: Permission,
          through: { attributes: [] }, // Exclude join table data
        },
      ],
    });
    
    let formattedRoles = roles.map((role: any) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.Permissions ? role.Permissions.map((p: any) => p.slug) : [],
    }));

    // Hide Super Admin role for non Super Admin requesters to prevent edits
    if (!isSuperAdmin) {
      formattedRoles = formattedRoles.filter((r) => {
        const name = String(r.name ?? '').toLowerCase();
        return name !== 'super admin' && name !== 'agent';
      });
    }

    sendSuccess(res, 'Code1', formattedRoles);
  } catch (error) {
    sendError(res, 'Code1100', 500);
  }
};

export const getRolesContext = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isSuperAdmin = await isRequesterSuperAdmin(req);
    const tenantId = getScopeTenantId(req, isSuperAdmin);
    if (!isSuperAdmin && !tenantId) {
      sendError(res, 'Code102', 403);
      return;
    }

    const roles = await Role.findAll({
      where: tenantId
        ? (isSuperAdmin
          ? ({
            [Op.or]: [
              { tenant_id: tenantId },
              { tenant_id: null, name: 'Super Admin' },
            ],
          } as any)
          : ({ tenant_id: tenantId } as any))
        : ({ tenant_id: null } as any),
      include: [
        {
          model: Permission,
          through: { attributes: [] },
        },
        {
          model: User,
          attributes: ['id'],
          through: { attributes: [] },
        },
      ],
    });

    let formattedRoles = roles.map((role: any) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.Permissions ? role.Permissions.map((p: any) => p.slug) : [],
      userCount: role.Users ? role.Users.length : 0,
    }));

    if (!isSuperAdmin) {
      formattedRoles = formattedRoles.filter((r) => {
        const name = String(r.name ?? '').toLowerCase();
        return name !== 'super admin' && name !== 'agent';
      });
    }

    sendSuccess(res, 'Code1', {
      generatedAt: new Date().toISOString(),
      roles: formattedRoles,
    });
  } catch (error) {
    sendError(res, 'Code1101', 500);
  }
};

export const createRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, permissions } = req.body; // permissions is array of slugs
    const { isSuperAdmin, isAgent } = await getRequesterRoleFlags(req);
    const tenantId = getScopeTenantId(req, isSuperAdmin);
    if (!tenantId) {
      sendError(res, 'Code102', 403);
      return;
    }

    const normalizedNameLower = normalizeRoleName(name).toLowerCase();
    const reserved = new Set([...Array.from(RESERVED_ROLE_NAMES), 'viewer']);
    if (reserved.has(normalizedNameLower) || isSensitiveRoleName(name)) {
      sendError(res, 'Code1112', 403);
      return;
    }

    if (!isSuperAdmin && normalizedNameLower === 'super admin') {
      sendError(res, 'Code1112', 403);
      return;
    }

    if (Array.isArray(permissions) && permissions.includes('action:game_adjust_balance') && !(isSuperAdmin || isAgent)) {
      sendError(res, 'Code1112', 403);
      return;
    }

    const role = await Role.create({
      tenant_id: tenantId,
      name,
      description,
      isSystem: false,
    });

    if (permissions && permissions.length > 0) {
      const perms = await Permission.findAll({
        where: { slug: permissions },
      });
      // @ts-ignore
      await role.setPermissions(perms);
    }

    await logAudit(req.user?.id, 'ROLE_CREATE', null, { name, description, permissions }, getClientIp(req) || undefined);
    flushCache(); // Invalidate permission cache

    sendSuccess(res, 'Code1103', role, undefined, 201);
  } catch (error) {
    sendError(res, 'Code1104', 500);
  }
};

export const updateRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description, permissions } = req.body;

    const { isSuperAdmin, isAgent } = await getRequesterRoleFlags(req);
    const tenantId = getScopeTenantId(req, isSuperAdmin);
    const role: any = await Role.findByPk(Number(id), { include: [Permission] });
    if (!role) {
      sendError(res, 'Code1105', 404);
      return;
    }

    if (!isSuperAdmin) {
      const scopeTid = Number(tenantId ?? null);
      const roleTid = Number(role.tenant_id ?? null);
      if (!Number.isFinite(scopeTid) || scopeTid <= 0 || roleTid !== scopeTid) {
        sendError(res, 'Code102', 403);
        return;
      }
    } else {
      const roleNameLower = String(role.name ?? '').toLowerCase();
      if (role.tenant_id == null && roleNameLower !== 'super admin') {
        sendError(res, 'Code102', 403);
        return;
      }
    }

    if (String(role.name ?? '').toLowerCase() === 'agent' && !isSuperAdmin) {
      sendError(res, 'Code1111', 403);
      return;
    }

    const originalData = {
        name: role.name,
        description: role.description,
        permissions: role.Permissions.map((p: any) => p.slug)
    };

    const originalHasAdjust = (originalData.permissions as string[]).includes('action:game_adjust_balance');
    const nextHasAdjust = Array.isArray(permissions)
      ? (permissions as string[]).includes('action:game_adjust_balance')
      : originalHasAdjust;
    if (originalHasAdjust !== nextHasAdjust && !(isSuperAdmin || isAgent)) {
      sendError(res, 'Code1112', 403);
      return;
    }

    const isProtected = Boolean(role.isSystem) || isProtectedSystemRoleName(role.name);
    if (isProtected) {
      const nextName = name != null ? normalizeRoleName(name) : null;
      const nextDescription = description != null ? String(description) : null;
      if ((nextName != null && nextName !== role.name) || (nextDescription != null && nextDescription !== role.description)) {
        sendError(res, 'Code1111', 403);
        return;
      }
    } else {
      const normalizedNameLower = name != null ? normalizeRoleName(name).toLowerCase() : '';
      const reserved = new Set([...Array.from(RESERVED_ROLE_NAMES), 'viewer']);
      if ((normalizedNameLower && reserved.has(normalizedNameLower)) || isSensitiveRoleName(name)) {
        sendError(res, 'Code1112', 403);
        return;
      }
    }

    const nextName = isProtected ? role.name : (name != null ? normalizeRoleName(name) : role.name);
    const nextDescription = isProtected ? role.description : (description != null ? String(description) : role.description);
    await role.update({ name: nextName, description: nextDescription });

    if (permissions) {
      const perms = await Permission.findAll({
        where: { slug: permissions },
      });
      // @ts-ignore
      await role.setPermissions(perms);
    }

    const newData = { name: nextName, description: nextDescription, permissions };
    await logAudit(req.user?.id, 'ROLE_UPDATE', originalData, newData, getClientIp(req) || undefined);
    flushCache(); // Invalidate permission cache

    sendSuccess(res, 'Code1106', role);
  } catch (error) {
    sendError(res, 'Code1107', 500);
  }
};

export const deleteRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const isSuperAdmin = await isRequesterSuperAdmin(req);
    const tenantId = getScopeTenantId(req, isSuperAdmin);
    const role: any = await Role.findByPk(Number(id));
    
    if (!role) {
      sendError(res, 'Code1105', 404);
      return;
    }

    if (!isSuperAdmin) {
      const scopeTid = Number(tenantId ?? null);
      const roleTid = Number(role.tenant_id ?? null);
      if (!Number.isFinite(scopeTid) || scopeTid <= 0 || roleTid !== scopeTid) {
        sendError(res, 'Code102', 403);
        return;
      }
    } else {
      if (role.tenant_id == null) {
        sendError(res, 'Code102', 403);
        return;
      }
    }

    if (String(role.name ?? '').toLowerCase() === 'agent' && !isSuperAdmin) {
      sendError(res, 'Code1108', 403);
      return;
    }

    if (role.isSystem || isProtectedSystemRoleName(role.name)) {
      sendError(res, 'Code1108', 403);
      return;
    }

    const originalData = role.toJSON();
    await role.destroy();

    await logAudit(req.user?.id, 'ROLE_DELETE', originalData, null, getClientIp(req) || undefined);
    flushCache(); // Invalidate permission cache

    sendSuccess(res, 'Code1109');
  } catch (error) {
    sendError(res, 'Code1110', 500);
  }
};

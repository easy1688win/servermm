import { Request, Response } from 'express';
import { Role, Permission, User } from '../models';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';
import { flushCache } from '../services/CacheService';
import { sendSuccess, sendError } from '../utils/response';

export const getRoleNames = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requester: any = await User.findByPk(req.user?.id, {
      include: [{ model: Role, through: { attributes: [] } }],
    });
    const isSuperAdmin = Boolean(requester?.Roles?.some((r: any) => r.name === 'Super Admin'));

    const roles = await Role.findAll({
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
      .filter((r: any) => (isSuperAdmin ? true : r.name !== 'Super Admin'));

    sendSuccess(res, 'Code1', formatted);
  } catch (error) {
    sendError(res, 'Code1100', 500);
  }
};

export const getAllRoles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Determine requester role membership
    const requester: any = await User.findByPk(req.user?.id, {
      include: [{ model: Role, through: { attributes: [] } }]
    });
    const isSuperAdmin = Boolean(requester?.Roles?.some((r: any) => r.name === 'Super Admin'));

    const roles = await Role.findAll({
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
      formattedRoles = formattedRoles.filter(r => r.name !== 'Super Admin');
    }

    sendSuccess(res, 'Code1', formattedRoles);
  } catch (error) {
    sendError(res, 'Code1100', 500);
  }
};

export const getRolesContext = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requester: any = await User.findByPk(req.user?.id, {
      include: [{ model: Role, through: { attributes: [] } }],
    });
    const isSuperAdmin = Boolean(
      requester?.Roles?.some((r: any) => r.name === 'Super Admin'),
    );

    const roles = await Role.findAll({
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
      formattedRoles = formattedRoles.filter((r) => r.name !== 'Super Admin');
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

    const normalizedName = String(name || '').trim().toLowerCase();
    if (normalizedName === 'super admin') {
      sendError(res, 'Code1102', 403);
      return;
    }

    const role = await Role.create({
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

    const role: any = await Role.findByPk(Number(id), { include: [Permission] });
    if (!role) {
      sendError(res, 'Code1105', 404);
      return;
    }

    const originalData = {
        name: role.name,
        description: role.description,
        permissions: role.Permissions.map((p: any) => p.slug)
    };

    if (role.isSystem) {
       // Optional: Prevent renaming system roles, but allow permission updates?
    }

    await role.update({ name, description });

    if (permissions) {
      const perms = await Permission.findAll({
        where: { slug: permissions },
      });
      // @ts-ignore
      await role.setPermissions(perms);
    }

    const newData = { name, description, permissions };
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
    const role: any = await Role.findByPk(Number(id));
    
    if (!role) {
      sendError(res, 'Code1105', 404);
      return;
    }

    if (role.isSystem) {
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

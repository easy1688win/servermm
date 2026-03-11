import { Request, Response } from 'express';
import { Role, Permission, User } from '../models';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';
import { flushCache } from '../services/CacheService';

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

    res.json(formattedRoles);
  } catch (error) {
    res.status(500).json({ message: 'R101' });
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

    res.json({
      generatedAt: new Date().toISOString(),
      roles: formattedRoles,
    });
  } catch (error) {
    res.status(500).json({ message: 'R102' });
  }
};

export const createRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, permissions } = req.body; // permissions is array of slugs

    const normalizedName = String(name || '').trim().toLowerCase();
    if (normalizedName === 'super admin') {
      res.status(403).json({ message: 'Cannot create reserved system role: Super Admin' });
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

    res.status(201).json(role);
  } catch (error) {
    res.status(500).json({ message: 'R103' });
  }
};

export const updateRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description, permissions } = req.body;

    const role: any = await Role.findByPk(Number(id), { include: [Permission] });
    if (!role) {
      res.status(404).json({ message: 'Role not found' });
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

    res.json(role);
  } catch (error) {
    res.status(500).json({ message: 'R104' });
  }
};

export const deleteRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const role: any = await Role.findByPk(Number(id));
    
    if (!role) {
      res.status(404).json({ message: 'Role not found' });
      return;
    }

    if (role.isSystem) {
      res.status(403).json({ message: 'Cannot delete system role' });
      return;
    }

    const originalData = role.toJSON();
    await role.destroy();

    await logAudit(req.user?.id, 'ROLE_DELETE', originalData, null, getClientIp(req) || undefined);
    flushCache(); // Invalidate permission cache

    res.json({ message: 'Role deleted' });
  } catch (error) {
    res.status(500).json({ message: 'R105' });
  }
};

import { Response } from 'express';
import { User, Permission, Role } from '../models';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';
import { invalidateCache } from '../services/CacheService';
import crypto from 'crypto';

const generateApiKey = () => crypto.randomBytes(32).toString('hex');

const maskIpForDisplay = (ip: string | null): string | null => {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  return trimmed;
};

export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    // Determine requester role membership
    const requesterId = req.user?.id;
    const requester: any = await User.findByPk(requesterId, {
      include: [{ model: Role, through: { attributes: [] } }]
    });
    const isSuperAdmin = Boolean(requester?.Roles?.some((r: any) => r.name === 'Super Admin'));
    const permissions = (req.user?.permissions || []) as string[];
    const canViewOthers = permissions.includes('action:user_view');

	const users = await User.findAll({
	  attributes: { exclude: ['password_hash'] },
	  include: [
		{
		  model: Role,
		  through: { attributes: [] }
		},
		{
		  model: Permission,
		  through: { attributes: [] }
		}
	  ]
	});
	
	let formattedUsers = users.map((user: any) => {
	  const rawLastAt = user.last_login_at;
	  const rawLastIp = user.last_login_ip;
	
	  let lastLoginTime: string | null = null;
	  let lastLoginIp: string | null = null;
	
	  if (rawLastAt instanceof Date) {
		lastLoginTime = rawLastAt.toISOString();
	  } else if (typeof rawLastAt === 'string') {
		lastLoginTime = rawLastAt;
	  } else if (rawLastAt != null) {
		console.warn('Invalid last_login_at for user', user.username, rawLastAt);
	  }
	
	  if (typeof rawLastIp === 'string' && rawLastIp.trim() !== '') {
		lastLoginIp = maskIpForDisplay(rawLastIp);
	  } else if (rawLastIp != null) {
		console.warn('Invalid last_login_ip for user', user.username, rawLastIp);
	  }

	  let apiKeyMask: string | null = null;
	  if (user.api_key && typeof user.api_key === 'string') {
		const key = user.api_key;
		if (key.length <= 8) {
		  apiKeyMask = '••••';
		} else {
		  apiKeyMask = `${key.slice(0, 4)}••••••••••••${key.slice(-4)}`;
		}
	  }
	
	  return {
		id: user.id,
		username: user.username,
		full_name: user.full_name,
		status: user.status,
		currency: user.currency,
		last_login_at: rawLastAt,
		last_login_ip: rawLastIp,
		lastLoginTime,
		lastLoginIp,
		apiKeyMask,
		roles: user.Roles ? user.Roles.map((r: any) => r.name) : [],
		permissions: user.Permissions ? user.Permissions.map((p: any) => p.slug) : [],
	  };
	});

    // Enforce visibility rules
    if (!isSuperAdmin) {
      formattedUsers = formattedUsers.filter(u => !u.roles.includes('Super Admin'));
    }

    if (!canViewOthers && requesterId != null) {
      formattedUsers = formattedUsers.filter(u => u.id === requesterId);
    }

    res.json(formattedUsers);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Error fetching users' });
  }
};

export const getUsersContext = async (req: AuthRequest, res: Response) => {
  try {
    const requesterId = req.user?.id;
    const requester: any = await User.findByPk(requesterId, {
      include: [{ model: Role, through: { attributes: [] } }],
    });
    const isSuperAdmin = Boolean(requester?.Roles?.some((r: any) => r.name === 'Super Admin'));
    const permissions = (req.user?.permissions || []) as string[];
    const canViewOthers = permissions.includes('action:user_view');
    const canViewRoles = permissions.includes('action:role_view') || permissions.includes('action:role_manage');

    const [usersRaw, rolesRaw] = await Promise.all([
      User.findAll({
        attributes: { exclude: ['password_hash'] },
        include: [
          {
            model: Role,
            through: { attributes: [] },
          },
          {
            model: Permission,
            through: { attributes: [] },
          },
        ],
      } as any),
      Role.findAll(),
    ]);

    let users = (usersRaw as any[]).map((user) => {
      const rawLastAt = user.last_login_at;
      const rawLastIp = user.last_login_ip;

      let lastLoginTime: string | null = null;
      if (rawLastAt instanceof Date) {
        lastLoginTime = rawLastAt.toISOString();
      } else if (typeof rawLastAt === 'string') {
        lastLoginTime = rawLastAt;
      }

      const lastLoginIpMasked = maskIpForDisplay(typeof rawLastIp === 'string' ? rawLastIp : null);

      let apiKeyMask: string | null = null;
      if (user.api_key && typeof user.api_key === 'string') {
        const key = user.api_key;
        if (key.length <= 8) {
          apiKeyMask = '••••';
        } else {
          apiKeyMask = `${key.slice(0, 4)}••••••••••••${key.slice(-4)}`;
        }
      }

      return {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        status: user.status,
        currency: user.currency,
        lastLoginTime,
        lastLoginIp: lastLoginIpMasked,
        apiKeyMask,
        roles: user.Roles ? user.Roles.map((r: any) => r.name) : [],
        permissions: user.Permissions ? user.Permissions.map((p: any) => p.slug) : [],
      };
    });

    if (!isSuperAdmin) {
      users = users.filter((u) => !(u.roles || []).includes('Super Admin'));
    }

    if (!canViewOthers && requesterId != null) {
      users = users.filter((u) => u.id === requesterId);
    }

    const roles = canViewRoles
      ? (rolesRaw as any[]).map((r) => ({
          id: r.id,
          name: r.name,
        }))
      : [];

    return res.json({
      generatedAt: new Date().toISOString(),
      users,
      roles,
    });
  } catch (error) {
    console.error('Error fetching user management context:', error);
    return res.status(500).json({ message: 'Error fetching user management context' });
  }
};

export const createUser = async (req: AuthRequest, res: Response) => {
  try {
    const { username, password, status, roles, permissions, fullName, full_name, currency } = req.body; // roles is array of role names, permissions array of slugs
    const fullNameVal = fullName ?? full_name ?? null;
    
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user: any = await User.create({
      username,
      password_hash: hashedPassword,
      status: status || 'active',
      currency: currency || 'USD',
      full_name: fullNameVal,
      api_key: generateApiKey()
    });

    if (roles && Array.isArray(roles)) {
      const roleObjects = await Role.findAll({ where: { name: roles } });
      await user.setRoles(roleObjects);
    }

    if (permissions && Array.isArray(permissions)) {
      const permissionObjects = await Permission.findAll({ where: { slug: permissions } });
      await user.setPermissions(permissionObjects);
    }

    await logAudit(req.user?.id, 'USER_CREATE', null, { username, status, roles, permissions }, getClientIp(req) || undefined);

    res.status(201).json({ 
      id: user.id, 
      username: user.username, 
      full_name: user.full_name,
      status: user.status,
      apiKey: user.api_key,
      roles: roles || [],
      permissions: permissions || []
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Error creating user' });
  }
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { username, status, roles, permissions, password, fullName, full_name } = req.body;

    const user: any = await User.findByPk(Number(id), { include: [Role, Permission] });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const originalData = {
        username: user.username,
        status: user.status,
        roles: user.Roles.map((r: any) => r.name),
        permissions: user.Permissions.map((p: any) => p.slug)
    };

    const updates: any = {};
    if (username) updates.username = username;
    if (status) updates.status = status;
    if (password) {
       updates.password_hash = await bcrypt.hash(password, 10);
       updates.token_version = (user.token_version || 0) + 1; // Increment version to revoke old tokens
    }
    const fullNameVal = fullName ?? full_name;
    if (typeof fullNameVal === 'string') updates.full_name = fullNameVal;

    await user.update(updates);

    if (roles && Array.isArray(roles)) {
      const roleObjects = await Role.findAll({ where: { name: roles } });
      await user.setRoles(roleObjects);
    }

    if (permissions && Array.isArray(permissions)) {
      const permissionObjects = await Permission.findAll({ where: { slug: permissions } });
      await user.setPermissions(permissionObjects);
    }

    const newData = { username, status, roles, permissions, fullName: fullName ?? full_name };
    await logAudit(req.user?.id, 'USER_UPDATE', originalData, newData, getClientIp(req) || undefined);
    invalidateCache(`user_permissions:${id}`);

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Error updating user' });
  }
};

export const rotateUserApiKey = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user: any = await User.findByPk(Number(id));
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.status === 'locked') {
      return res.status(403).json({ message: 'Account is locked' });
    }
    const oldKey = user.api_key;
    const newKey = generateApiKey();
    user.api_key = newKey;
    await user.save();
    await logAudit(req.user?.id, 'USER_API_KEY_ROTATE', { id: user.id, username: user.username, oldKey: oldKey ? '***' : null }, { id: user.id, username: user.username, newKey: '***' }, getClientIp(req) || undefined);
    invalidateCache(`user_permissions:${id}`);
    res.json({ apiKey: newKey });
  } catch (error) {
    console.error('Error rotating user API key:', error);
    res.status(500).json({ message: 'Error rotating user API key' });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const user: any = await User.findByPk(Number(id));
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (user.id === req.user?.id) {
        return res.status(403).json({ message: 'Cannot delete your own account' });
      }
  
      const originalData = user.toJSON();
      await user.destroy();
  
      await logAudit(req.user?.id, 'USER_DELETE', originalData, null, getClientIp(req) || undefined);
      invalidateCache(`user_permissions:${id}`);
  
      res.json({ message: 'User deleted' });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ message: 'Error deleting user' });
    }
  };

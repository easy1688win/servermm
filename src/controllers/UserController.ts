import { Request, Response } from 'express';
import { User, Permission, Role, UserRole, UserPermission } from '../models';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';
import { invalidateCache } from '../services/CacheService';
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

export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Determine requester role membership
    const requesterId = req.user?.id;
    const requester = await User.findByPk(requesterId, {
      include: [{ model: Role, through: { attributes: [] } }]
    });
    
    // Check if requester is Super Admin
    const isSuperAdmin = Boolean(requester?.Roles?.some((r: Role) => r.name === 'Super Admin'));
    
    // Check specific permissions
    const permissions = (req.user?.permissions || []) as string[];
    const canViewOthers = permissions.includes('action:user_view');
    const canViewFullIp = permissions.includes('view:full_ip');
    const canViewSensitive = permissions.includes('view:sensitive_info');

    // If not super admin and cannot view others, return only self
    const whereClause: any = {};
    if (!isSuperAdmin && !canViewOthers) {
       whereClause.id = requesterId;
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
        }
      ]
    });
    
    let visibleUsers = users;
    if (!isSuperAdmin && canViewOthers) {
        visibleUsers = users.filter(u => !u.Roles?.some((r: Role) => r.name === 'Super Admin'));
    }

    const formattedUsers = visibleUsers.map((user) => {
      // Basic fields
      const base = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        status: user.status,
        currency: user.currency,
        roles: user.Roles ? user.Roles.map((r: Role) => r.name) : [],
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
          api_key: apiKeyMask
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
    
    const isSuperAdmin = Boolean(requester?.Roles?.some((r: Role) => r.name === 'Super Admin'));
    
    // Get roles with permission filtering
    let roles = await Role.findAll({
        include: [Permission]
    });
    
    // Filter roles: non-superadmin users cannot see Super Admin role
    if (!isSuperAdmin) {
        roles = roles.filter(role => role.name !== 'Super Admin');
    }
    
    const permissions = await Permission.findAll();
    
    // Also return users as part of the context since the frontend expects it
    // Or we should update the frontend to call getUsers separately. 
    // Looking at the previous code provided by user, getUsersContext returned users too.
    
    // Reuse logic from getUsers but without response sending
    const userPermissions = (req.user?.permissions || []) as string[];
    const canViewOthers = userPermissions.includes('action:user_view');
    const canViewFullIp = userPermissions.includes('view:full_ip');
    const canViewSensitive = userPermissions.includes('view:sensitive_info');

    const whereClause: any = {};
    if (!isSuperAdmin && !canViewOthers) {
       whereClause.id = requesterId;
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
        }
      ]
    });

    let visibleUsers = users;
    if (!isSuperAdmin && canViewOthers) {
        visibleUsers = users.filter(u => !u.Roles?.some((r: Role) => r.name === 'Super Admin'));
    }

    const formattedUsers = visibleUsers.map((user) => {
      const base = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        status: user.status,
        currency: user.currency,
        roles: user.Roles ? user.Roles.map((r: Role) => r.name) : [],
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
          twoFactorEnabled: user.two_factor_enabled
      };
    });

    sendSuccess(res, 'Code1', { roles, permissions, users: formattedUsers });
  } catch (error) {
    sendError(res, 'Code603', 500); // Internal server error
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, password, full_name, fullName, roles, permissions, currency } = req.body;
    
    // Check if requester is Super Admin
    const requesterId = req.user?.id;
    const requester = await User.findByPk(requesterId, {
      include: [{ model: Role, through: { attributes: [] } }]
    });
    
    const isSuperAdmin = Boolean(requester?.Roles?.some((r: Role) => r.name === 'Super Admin'));
    
    // Validate roles: non-superadmin users cannot assign Super Admin role
    if (roles && Array.isArray(roles)) {
        if (!isSuperAdmin && roles.includes('Super Admin')) {
            sendError(res, 'Code604', 403); // Access denied: Cannot assign Super Admin role
            return;
        }
    }
    
    const existing = await User.findOne({ where: { username } });
    if (existing) {
        sendError(res, 'Code605', 400); // Username already exists
        return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    const effectiveFullName = full_name ?? fullName;
    
    const user = await User.create({
        username,
        password_hash,
        full_name: effectiveFullName,
        currency: currency || 'USD',
        status: 'active',
        token_version: 0,
        api_key: generateApiKey()
    });

    if (roles && Array.isArray(roles)) {
        const roleObjects = await Role.findAll({
             where: {
                 name: {
                     [Op.in]: roles
                 }
             }
        });
        
        for (const role of roleObjects) {
            await UserRole.create({ userId: user.id, roleId: role.id });
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
    const { username, password, full_name, fullName, roles, permissions, status, currency } = req.body;
    
    // Check if requester is Super Admin
    const requesterId = req.user?.id;
    const requester = await User.findByPk(requesterId, {
      include: [{ model: Role, through: { attributes: [] } }]
    });
    
    const isSuperAdmin = Boolean(requester?.Roles?.some((r: Role) => r.name === 'Super Admin'));
    
    // Validate roles: non-superadmin users cannot assign Super Admin role
    if (roles && Array.isArray(roles)) {
        if (!isSuperAdmin && roles.includes('Super Admin')) {
            sendError(res, 'Code604', 403); // Access denied: Cannot assign Super Admin role
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

    const original = user.toJSON();

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

    await user.save();

    //禁止修改roles - 角色权限是核心安全设置
    if (roles !== undefined) {
      sendError(res, 'Code611', 400); // Roles cannot be modified
      return;
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

import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Setting, User, Role } from '../models';
import { decrypt, isEncrypted } from '../utils/encryption';
import { sendWarning, sendError, sendSuccess } from '../utils/response';

type MaintenanceSettings = {
  maintenance_mode?: boolean;
  allowed_roles?: string[];
  [key: string]: any;
};

const normalizeSettings = (value: any): MaintenanceSettings => {
  let raw: any = value;
  if (typeof raw === 'string' && (raw.startsWith('{') || raw.startsWith('['))) {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if (!raw || typeof raw !== 'object') {
    raw = {};
  }
  const allowed = Array.isArray(raw.allowed_roles)
    ? raw.allowed_roles.map((r: any) => String(r)).filter((r: string) => r.trim().length > 0)
    : undefined;
  return {
    ...raw,
    maintenance_mode: Boolean(raw.maintenance_mode),
    allowed_roles: allowed,
  };
};

const getMaintenanceSettings = async (): Promise<MaintenanceSettings> => {
  try {
    const setting = await Setting.findByPk('maintenance');
    return normalizeSettings(setting ? (setting as any).value : { maintenance_mode: false });
  } catch {
    return { maintenance_mode: false };
  }
};

const getTokenFromRequest = (req: Request): string | null => {
  const cookieToken = (req as any).cookies?._T;
  if (cookieToken) {
    return String(cookieToken);
  }
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
};

const getRoleNamesForToken = async (token: string): Promise<string[]> => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return [];
  }
  try {
    const decoded = jwt.verify(token, secret) as any;
    const userId = decoded?.id;
    if (!userId) {
      return [];
    }
    const user = await User.findByPk(userId, {
      include: [{ model: Role, attributes: ['name'] }],
    });
    const roles = (user as any)?.Roles;
    if (!Array.isArray(roles)) {
      return [];
    }
    return roles
      .map((r: any) => String(r?.name ?? '').trim())
      .filter((n: string) => n.length > 0);
  } catch {
    return [];
  }
};

export const checkMaintenanceMode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await getMaintenanceSettings();

    if (!settings.maintenance_mode) {
      return next();
    }

    const authEndpoints = ['/auth/login', '/auth/get-us', '/auth/2fa/verify', '/auth/logout'];
    if (authEndpoints.some(endpoint => req.path.includes(endpoint)) || req.path.includes('/maintenance')) {
      return next();
    }

    const configuredAllowed = Array.isArray(settings.allowed_roles)
      ? settings.allowed_roles.map((r) => String(r).trim()).filter(Boolean)
      : [];

    const allowedRoleSet = new Set<string>(configuredAllowed.map((r) => r.toLowerCase()));

    const tokenRaw = getTokenFromRequest(req);
    if (tokenRaw) {
      const token = isEncrypted(tokenRaw) ? decrypt(tokenRaw) : tokenRaw;
      const roleNames = await getRoleNamesForToken(token);
      const bypass = roleNames.some((name) => allowedRoleSet.has(name.toLowerCase()));
      if (bypass) {
        return next();
      }
    }

    if (req.path.startsWith('/api/')) {
      sendWarning(res, 'api.systemIsUnderMaintenance', settings, undefined, 503);
      return;
    }

    next();
  } catch {
    next();
  }
};

export const getMaintenanceStatus = async (req: Request, res: Response) => {
  try {
    const settings = await getMaintenanceSettings();
    sendSuccess(res, 'Code1', settings);
  } catch {
    sendError(res, 'Code2', 500); // Internal server error
  }
};

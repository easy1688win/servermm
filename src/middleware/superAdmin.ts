import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { sendError } from '../utils/response';
import { Role, User } from '../models';

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    sendError(res, 'Code101', 401);
    return;
  }
  if (!req.user.is_super_admin) {
    sendError(res, 'Code102', 403);
    return;
  }
  next();
};

export const requireSuperAdminOrAgent = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      sendError(res, 'Code101', 401);
      return;
    }
    if (Boolean(req.user.is_super_admin)) {
      next();
      return;
    }

    const requesterId = req.user.id;
    const scopeTenantId = (req.user as any)?.tenant_id ?? null;
    const requester: any = await User.findByPk(requesterId, {
      include: [{
        model: Role,
        through: { attributes: [] },
        required: false,
        where: scopeTenantId ? ({ tenant_id: scopeTenantId, name: 'Agent' } as any) : ({ name: 'Agent' } as any),
      }],
    } as any);

    const isAgent = Boolean((requester?.Roles?.length ?? 0) > 0);
    if (!isAgent) {
      sendError(res, 'Code102', 403);
      return;
    }
    next();
  } catch {
    sendError(res, 'Code102', 403);
  }
};

import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { sendError } from '../utils/response';

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


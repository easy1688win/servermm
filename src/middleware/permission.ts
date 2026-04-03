import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { sendError } from '../utils/response';

export const requirePermission = (requiredPermission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      sendError(res, 'Code101', 401);
      return;
    }

    const userPermissions = req.user.permissions || [];

    if (!userPermissions.includes(requiredPermission)) {
      sendError(res, 'Code102', 403);
      return;
    }

    next();
  };
};

export const requireAnyPermission = (requiredPermissions: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        sendError(res, 'Code101', 401);
        return;
      }
  
      const userPermissions = req.user.permissions || [];
  
      const hasPermission = requiredPermissions.some(p => userPermissions.includes(p));
  
      if (!hasPermission) {
        sendError(res, 'Code102', 403);
        return;
      }
  
      next();
    };
  };

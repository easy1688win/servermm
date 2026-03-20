import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

export const requirePermission = (requiredPermission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'API Access Denied.' });
    }

    const userPermissions = req.user.permissions || [];

    if (!userPermissions.includes(requiredPermission)) {
      return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
    }

    next();
  };
};

export const requireAnyPermission = (requiredPermissions: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({ message: 'API Access Denied.' });
      }
  
      const userPermissions = req.user.permissions || [];
  
      const hasPermission = requiredPermissions.some(p => userPermissions.includes(p));
  
      if (!hasPermission) {
        return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
      }
  
      next();
    };
  };

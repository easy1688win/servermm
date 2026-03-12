import { Router } from 'express';
import { getUsers, getUsersContext, createUser, updateUser, deleteUser, rotateUserApiKey } from '../controllers/UserController';
import { authenticateToken } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/permission';

const router = Router();

router.use(authenticateToken);

router.get(
  '/context',
  requireAnyPermission([
    'route:users',
    'action:user_view',
    'action:user_create',
    'action:user_edit',
    'action:user_delete',
    'action:role_manage',
  ]),
  getUsersContext
);
router.get(
  '/',
  requireAnyPermission([
    'route:users',
    'action:user_view',
    'action:user_create',
    'action:user_edit',
    'action:user_delete',
    'action:role_manage',
  ]),
  getUsers
);
router.post(
  '/',
  requireAnyPermission(['action:user_create']),
  createUser
);
router.put(
  '/:id',
  requireAnyPermission(['action:user_edit']),
  updateUser
);
router.delete(
  '/:id',
  requireAnyPermission(['action:user_delete']),
  deleteUser
);
router.post('/:id/api-key/rotate', requirePermission('action:user_api_manage'), rotateUserApiKey);

export default router;

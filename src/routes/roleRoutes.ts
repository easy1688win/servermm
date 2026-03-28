import { Router } from 'express';
import { getAllRoles, createRole, updateRole, deleteRole, getRolesContext, getRoleNames } from '../controllers/RoleController';
import { authenticateToken } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/permission';

const router = Router();

router.use(authenticateToken);

router.get('/context', requireAnyPermission(['action:role_view', 'action:role_manage']), getRolesContext);
router.get('/allow', requireAnyPermission(['action:role_view', 'action:role_manage']), getRoleNames);
router.get('/', requireAnyPermission(['action:role_view', 'action:role_manage']), getAllRoles);
router.post('/', requirePermission('action:role_manage'), createRole);
router.put('/:id', requirePermission('action:role_manage'), updateRole);
router.delete('/:id', requirePermission('action:role_manage'), deleteRole);

export default router;

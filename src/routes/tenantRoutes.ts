import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { requireSuperAdmin } from '../middleware/superAdmin';
import { createTenant, listTenants, updateTenant } from '../controllers/TenantController';

const router = Router();

router.get('/', authenticateToken, requirePermission('action:settings_manage'), requireSuperAdmin, listTenants);
router.post('/', authenticateToken, requirePermission('action:settings_manage'), requireSuperAdmin, createTenant);
router.put('/:id', authenticateToken, requirePermission('action:settings_manage'), requireSuperAdmin, updateTenant);

export default router;


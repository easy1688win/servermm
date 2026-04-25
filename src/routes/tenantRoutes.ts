import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { requireSuperAdminOrAgent } from '../middleware/superAdmin';
import { createTenant, listTenants, updateTenant } from '../controllers/TenantController';

const router = Router();

router.get('/', authenticateToken, requirePermission('action:settings_manage'), requireSuperAdminOrAgent, listTenants);
router.post('/', authenticateToken, requirePermission('action:settings_manage'), requireSuperAdminOrAgent, createTenant);
router.put('/:id', authenticateToken, requirePermission('action:settings_manage'), requireSuperAdminOrAgent, updateTenant);

export default router;

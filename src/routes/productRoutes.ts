import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { create, getAll, remove, update } from '../controllers/ProductController';

const router = Router();

router.use(authenticateToken);

router.use(requireAnyPermission(['route:settings', 'action:settings_manage']));

router.get('/', getAll);
router.post('/', requirePermission('action:settings_manage'), create);
router.put('/:id', requirePermission('action:settings_manage'), update);
router.delete('/:id', requirePermission('action:settings_manage'), remove);

export default router;

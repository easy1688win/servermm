import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { getAll, create, remove } from '../controllers/BankCatalogController';

const router = Router();

router.use(authenticateToken);

router.get('/', getAll);
router.post('/', requirePermission('action:settings_manage'), create);
router.delete('/:id', requirePermission('action:settings_manage'), remove);

export default router;

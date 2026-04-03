import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/permission';
import { getAll, getByKey, setByKey } from '../controllers/SettingController';

const router = Router();

router.use(authenticateToken);

router.get('/', requireAnyPermission(['route:settings', 'view:system_settings', 'action:settings_manage']), getAll);
router.get('/:key', requireAnyPermission(['route:settings', 'view:system_settings', 'action:settings_manage']), getByKey);
router.post('/:key', requirePermission('action:settings_manage'), setByKey);

export default router;

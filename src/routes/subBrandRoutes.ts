import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { createSubBrand, listSubBrands, updateSubBrand } from '../controllers/SubBrandController';

const router = Router();

router.get('/', authenticateToken, requirePermission('action:settings_manage'), listSubBrands);
router.post('/', authenticateToken, requirePermission('action:settings_manage'), createSubBrand);
router.put('/:id', authenticateToken, requirePermission('action:settings_manage'), updateSubBrand);

export default router;

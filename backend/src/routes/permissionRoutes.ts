import { Router } from 'express';
import { getAllPermissions } from '../controllers/PermissionController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.get('/', getAllPermissions);

export default router;

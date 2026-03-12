import { Router } from 'express';
import { getDashboardSummary } from '../controllers/DashboardController';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';

const router = Router();

router.use(authenticateToken);

router.get('/summary', requirePermission('route:dashboard'), getDashboardSummary);

export default router;


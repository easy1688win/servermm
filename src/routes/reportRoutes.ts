import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { getPlayerGameLogHistoryUrl, getPlayerGameLogReport, getPlayerWinLossReport } from '../controllers/ReportController';

const router = Router();

router.use(authenticateToken);

router.get('/player-winloss', requirePermission('route:reports'), getPlayerWinLossReport);
router.get('/game-log', requirePermission('route:reports'), getPlayerGameLogReport);
router.get('/game-log/history-url', requirePermission('route:reports'), getPlayerGameLogHistoryUrl);

export default router;

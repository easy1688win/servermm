import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { getPlayerGameLogHistoryUrl, getPlayerGameLogReport, getPlayerWinLossReport } from '../controllers/ReportController';
import { getTransactionsContext } from '../controllers/TransactionController';

const router = Router();

router.use(authenticateToken);

router.get('/player-winloss', requirePermission('route:reports:player_winloss'), getPlayerWinLossReport);
router.get('/game-log', requirePermission('route:reports:game_log'), getPlayerGameLogReport);
router.get('/game-log/history-url', requirePermission('route:reports:game_log'), getPlayerGameLogHistoryUrl);

// Summary Report - uses kiosk scope internally
router.get('/summary/data', requirePermission('route:reports:summary'), (req, res, next) => {
  // Inject scope=kiosk for internal processing
  req.query.scope = 'kiosk';
  return getTransactionsContext(req, res);
});

// Kiosk Report - uses kiosk scope internally
router.get('/kiosk/data', requirePermission('route:reports:kiosk'), (req, res, next) => {
  // Inject scope=kiosk for internal processing
  req.query.scope = 'kiosk';
  return getTransactionsContext(req, res);
});

export default router;

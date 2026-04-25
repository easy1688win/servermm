import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/permission';
import { getAllGames, createGame, deleteGame, adjustBalance, getGameAdjustments, getGamesContext, getGameById, update } from '../controllers/GameController';

const router = Router();

router.use(authenticateToken);

router.get(
  '/context',
  requireAnyPermission(['view:games', 'route:settings', 'action:settings_manage']),
  getGamesContext,
);
router.get('/', getAllGames);
router.get('/adjustments', getGameAdjustments);
router.get('/:id', requireAnyPermission(['view:games', 'route:settings', 'action:settings_manage']), getGameById);
router.post('/', requirePermission('action:game_operational'), createGame);
router.put('/:id', requirePermission('action:game_operational'), update);
router.delete('/:id', requirePermission('action:game_operational'), deleteGame);
router.post('/:id/adjust', requirePermission('action:game_adjust_balance'), adjustBalance);

export default router;

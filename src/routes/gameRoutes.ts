import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/permission';
import { getAllGames, createGame, deleteGame, adjustBalance, getGameAdjustments, getGamesContext, update } from '../controllers/GameController';

const router = Router();

router.use(authenticateToken);

router.get(
  '/context',
  requireAnyPermission(['view:games', 'route:settings', 'action:settings_manage']),
  getGamesContext,
);
router.get('/', getAllGames);
router.post('/', requireAnyPermission(['action:game_operational', 'action:settings_manage']), createGame); // Or appropriate permission
router.put('/:id', requireAnyPermission(['action:game_operational', 'action:settings_manage']), update);
router.delete('/:id', requireAnyPermission(['action:game_operational', 'action:settings_manage']), deleteGame);
router.post('/:id/adjust', requireAnyPermission(['action:game_operational', 'action:settings_manage']), adjustBalance); // Maybe specific permission for adjustment
router.get('/adjustments', getGameAdjustments);

export default router;

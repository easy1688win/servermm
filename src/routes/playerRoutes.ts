import { Router } from 'express';
import { getPlayers, getPlayerList, searchPlayers, createPlayer, updatePlayer, deletePlayer, getNextPlayerId, getPlayerStatistics, retryCreateGameAccount, syncActiveGameAccounts } from '../controllers/PlayerController';
import { authenticateToken } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';

const router = Router();

router.use(authenticateToken);

router.get('/', requirePermission('route:players'), getPlayers);
router.get('/list', requirePermission('route:players'), getPlayerList);
router.get('/search', requireAnyPermission(['route:players', 'action:player_create', 'action:player_edit']), searchPlayers);
router.get('/statistics', requirePermission('route:players'), getPlayerStatistics);
router.get('/newid', requirePermission('action:player_create'), getNextPlayerId);
router.post('/', requirePermission('action:player_create'), createPlayer);
router.post('/:id/game-accounts/retry-create', requirePermission('action:player_edit'), retryCreateGameAccount);
router.post('/:id/game-accounts/sync-active', requirePermission('action:player_edit'), syncActiveGameAccounts);
router.put('/:id', requirePermission('action:player_edit'), updatePlayer);
router.delete('/:id', requirePermission('action:player_edit'), deletePlayer);

export default router;

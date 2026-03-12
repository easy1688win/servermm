import { Router } from 'express';
import { getPlayers, getPlayerList, searchPlayers, createPlayer, updatePlayer, deletePlayer, getNextPlayerId } from '../controllers/PlayerController';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';

const router = Router();

router.use(authenticateToken);

router.get('/', requirePermission('route:players'), getPlayers);
router.get('/list', requirePermission('route:players'), getPlayerList);
router.get('/search', requirePermission('route:players'), searchPlayers);
router.get('/newid', requirePermission('action:player_create'), getNextPlayerId);
router.post('/', requirePermission('action:player_create'), createPlayer);
router.put('/:id', requirePermission('action:player_edit'), updatePlayer);
router.delete('/:id', requirePermission('action:player_edit'), deletePlayer);

export default router;

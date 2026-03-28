import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import {
  createPlayer,
  setPlayerStatus,
  setPlayerPassword,
  logoutPlayer,
  getPlayerBalance,
  deposit,
  withdraw,
  withdrawAll,
  verifyTransfer,
  getGameList,
  launchGame,
  getTransactionsByHour,
  getTransactionsByMinute,
  getWinloss,
  getHistoryUrl,
  getJackpot,
} from '../controllers/GameVendorController';

const router = Router({ mergeParams: true });

// All routes require authentication
router.use(authenticateToken);

// ==================== Player Management ====================
// Create player - requires game operational permission
router.post(
  '/players',
  requirePermission('action:game_operational'),
  createPlayer
);

// Set player status
router.put(
  '/players/:username/status',
  requireAnyPermission(['action:game_operational', 'action:player_edit']),
  setPlayerStatus
);

// Set player password
router.put(
  '/players/:username/password',
  requireAnyPermission(['action:game_operational', 'action:player_edit']),
  setPlayerPassword
);

// Logout player
router.post(
  '/players/:username/logout',
  requireAnyPermission(['action:game_operational', 'action:player_edit']),
  logoutPlayer
);

// Get player balance
router.get(
  '/players/:username/balance',
  requirePermission('view:games'),
  getPlayerBalance
);

// ==================== Credit Operations ====================
// Deposit to player
router.post(
  '/players/:username/deposit',
  requirePermission('action:game_operational'),
  deposit
);

// Withdraw from player
router.post(
  '/players/:username/withdraw',
  requirePermission('action:game_operational'),
  withdraw
);

// Withdraw all from player
router.post(
  '/players/:username/withdraw-all',
  requirePermission('action:game_operational'),
  withdrawAll
);

// Verify transfer
router.get(
  '/transfers/:requestId/verify',
  requirePermission('view:games'),
  verifyTransfer
);

// ==================== Game Launch ====================
// Get game list
router.get(
  '/games',
  requirePermission('view:games'),
  getGameList
);

// Launch game
router.post(
  '/launch',
  requirePermission('action:game_operational'),
  launchGame
);

// ==================== Transactions ====================
// Get transactions by hour
router.get(
  '/transactions/hour',
  requirePermission('view:games'),
  getTransactionsByHour
);

// Get transactions by minute
router.get(
  '/transactions/minute',
  requirePermission('view:games'),
  getTransactionsByMinute
);

// Get win/loss report
router.get(
  '/winloss',
  requirePermission('view:games'),
  getWinloss
);

// Get history URL
router.get(
  '/history',
  requirePermission('view:games'),
  getHistoryUrl
);

// ==================== Jackpot ====================
// Get jackpot amount
router.get(
  '/jackpot',
  requirePermission('view:games'),
  getJackpot
);

export default router;

import { Response } from 'express';
import { logAudit, getClientIp } from '../services/AuditService';
import { AuthRequest } from '../middleware/auth';
import { Game, Product } from '../models';
import { VendorFactory } from '../services/vendor/VendorFactory';
import { sendSuccess, sendError } from '../utils/response';
import { getTenancyScopeOrThrow, withTenancyWhere } from '../tenancy/scope';

/**
 * Generate unique request ID for Joker API calls
 */
const generateRequestId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const getVendor = async (req: AuthRequest, gameId: number, res: Response) => {
  const scope = getTenancyScopeOrThrow(req);
  const game = await Game.findOne({
    where: withTenancyWhere(scope, { id: gameId }),
    include: [{ model: Product, attributes: ['providerCode'], required: false }],
  } as any);
  if (!game) {
    sendError(res, 'Code1008', 404);
    return null;
  }
  if (!game.use_api) {
    sendError(res, 'Code9001', 400);
    return null;
  }

  const providerCode = (game as any).Product?.providerCode;
  if (providerCode == null) {
    sendError(res, 'Code9001', 400);
    return null;
  }

  const vendor = await VendorFactory.getServiceByProviderCode(providerCode, gameId);
  if (!vendor) {
    sendError(res, 'Code9001', 400);
    return null;
  }

  const ok = await vendor.isAvailable();
  if (!ok) {
    sendError(res, 'Code9001', 400);
    return null;
  }
  return vendor;
};

// ==================== Player Management ====================

/**
 * Create a new player in Joker system
 * POST /api/games/:gameId/vendor/players
 */
export const createPlayer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId } = req.params;
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      sendError(res, 'Code9004', 400);
      return;
    }

    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const result = await vendor.createPlayer(username);

    // Log audit
    await logAudit(
      req.user?.id || null,
      `vendor:create_player`,
      null,
      { gameId: String(gameId), player: username, status: result.status },
      getClientIp(req) || null
    );

    sendSuccess(res, 'Code1', { success: true, message: result.message, status: result.status });
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to create player' });
  }
};

/**
 * Set player status
 * PUT /api/games/:gameId/vendor/players/:username/status
 */
export const setPlayerStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId, username } = req.params;
    const { status } = req.body;

    if (!status || !['Active', 'Suspend'].includes(status)) {
      sendError(res, 'Code9004', 400);
      return;
    }

    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const result = await vendor.setPlayerStatus(String(username), status as 'Active' | 'Suspend');
    if (!result.success) {
      sendError(res, 'Code9000', 400, { detail: result.error || 'Failed to set player status' });
      return;
    }

    await logAudit(
      req.user?.id || null,
      `vendor:set_player_status`,
      null,
      { gameId: String(gameId), player: username, status },
      getClientIp(req) || null
    );

    sendSuccess(res, 'Code1', { success: true });
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to set player status' });
  }
};

/**
 * Set player password
 * PUT /api/games/:gameId/vendor/players/:username/password
 */
export const setPlayerPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId, username } = req.params;
    const { password } = req.body;

    if (!password || typeof password !== 'string' || password.length < 4) {
      sendError(res, 'Code9004', 400);
      return;
    }

    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const result = await vendor.setPlayerPassword(String(username), password);
    if (!result.success) {
      sendError(res, 'Code9000', 400, { detail: result.error || 'Failed to set player password' });
      return;
    }

    await logAudit(
      req.user?.id || null,
      `vendor:set_player_password`,
      null,
      { gameId: String(gameId), player: username },
      getClientIp(req) || null
    );

    sendSuccess(res, 'Code1', { success: true });
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to set player password' });
  }
};

/**
 * Logout player
 * POST /api/games/:gameId/vendor/players/:username/logout
 */
export const logoutPlayer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId, username } = req.params;

    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const result = await vendor.logoutPlayer(String(username));
    if (!result.success) {
      sendError(res, 'Code9000', 400, { detail: result.error || 'Failed to logout player' });
      return;
    }

    await logAudit(
      req.user?.id || null,
      `vendor:logout_player`,
      null,
      { gameId: String(gameId), player: username },
      getClientIp(req) || null
    );

    sendSuccess(res, 'Code1', { success: true });
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to logout player' });
  }
};

// ==================== Credit/Balance ====================

/**
 * Get player balance
 * GET /api/games/:gameId/vendor/players/:username/balance
 */
export const getPlayerBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const includeVendorRaw = Boolean((req as any)?.user?.is_super_admin);
    const { gameId, username } = req.params;
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const result = await vendor.getBalance(String(username));
    if (!includeVendorRaw && result && typeof result === 'object') {
      delete (result as any).raw;
    }

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to get balance' });
  }
};

/**
 * Deposit credit to player
 * POST /api/games/:gameId/vendor/players/:username/deposit
 */
export const deposit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const includeVendorRaw = Boolean((req as any)?.user?.is_super_admin);
    const { gameId, username } = req.params;
    const { amount } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
      sendError(res, 'Code9005', 400);
      return;
    }
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const requestId = generateRequestId();
    const result = await vendor.deposit(String(username), amount, requestId);
    const vendorRaw = (result as any)?.raw;
    if (!includeVendorRaw && result && typeof result === 'object') {
      delete (result as any).raw;
    }

    await logAudit(
      req.user?.id || null,
      `vendor:deposit`,
      { beforeCredit: result.beforeCredit },
      { amount, credit: result.credit, requestId, vendorRaw },
      getClientIp(req) || null
    );

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to deposit' });
  }
};

/**
 * Withdraw credit from player
 * POST /api/games/:gameId/vendor/players/:username/withdraw
 */
export const withdraw = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const includeVendorRaw = Boolean((req as any)?.user?.is_super_admin);
    const { gameId, username } = req.params;
    const { amount } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
      sendError(res, 'Code9005', 400);
      return;
    }
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const requestId = generateRequestId();
    const result = await vendor.withdraw(String(username), amount, requestId);
    const vendorRaw = (result as any)?.raw;
    if (!includeVendorRaw && result && typeof result === 'object') {
      delete (result as any).raw;
    }

    await logAudit(
      req.user?.id || null,
      `vendor:withdraw`,
      { beforeCredit: result.beforeCredit },
      { amount: -amount, credit: result.credit, requestId, vendorRaw },
      getClientIp(req) || null
    );

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to withdraw' });
  }
};

/**
 * Withdraw all credit from player
 * POST /api/games/:gameId/vendor/players/:username/withdraw-all
 */
export const withdrawAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const includeVendorRaw = Boolean((req as any)?.user?.is_super_admin);
    const { gameId, username } = req.params;
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const requestId = generateRequestId();
    const result = await vendor.withdrawAll(String(username), requestId);
    const vendorRaw = (result as any)?.raw;
    if (!includeVendorRaw && result && typeof result === 'object') {
      delete (result as any).raw;
    }

    await logAudit(
      req.user?.id || null,
      `vendor:withdraw_all`,
      null,
      { amount: result.amount, requestId, vendorRaw },
      getClientIp(req) || null
    );

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to withdraw all credit' });
  }
};

/**
 * Verify a transfer by request ID
 * GET /api/games/:gameId/vendor/transfers/:requestId/verify
 */
export const verifyTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const includeVendorRaw = Boolean((req as any)?.user?.is_super_admin);
    const { gameId, requestId } = req.params;
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const vendorAny = vendor as any;
    if (typeof vendorAny.verifyTransfer !== 'function') {
      sendError(res, 'Code9003', 400);
      return;
    }
    const result = await vendorAny.verifyTransfer(String(requestId));
    if (!includeVendorRaw && result && typeof result === 'object') {
      delete (result as any).raw;
    }

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to verify transfer' });
  }
};

// ==================== Game Launch ====================

/**
 * Get game list
 * GET /api/games/:gameId/vendor/games
 */
export const getGameList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId } = req.params;
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const vendorAny = vendor as any;
    if (typeof vendorAny.getGameList !== 'function') {
      sendError(res, 'Code9003', 400);
      return;
    }
    const games = await vendorAny.getGameList();

    sendSuccess(res, 'Code1', { games });
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to get game list' });
  }
};

/**
 * Launch game
 * POST /api/games/:gameId/vendor/launch
 */
export const launchGame = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const includeVendorRaw = Boolean((req as any)?.user?.is_super_admin);
    const { gameId } = req.params;
    const { username, gameCode, mode, amount, language, template } = req.body;

    if (!username || !gameCode) {
      sendError(res, 'Code9004', 400);
      return;
    }
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const result = await vendor.launchGame(username, gameCode, {
      mode,
      amount,
      language: language || 'zh',
      template,
    });
    if (!includeVendorRaw && result && typeof result === 'object') {
      delete (result as any).raw;
    }

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to launch game' });
  }
};

// ==================== Transactions ====================

/**
 * Get transactions by hour
 * GET /api/games/:gameId/vendor/transactions/hour
 */
export const getTransactionsByHour = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId } = req.params;
    const { startDate, endDate, nextId } = req.query;

    if (!startDate || !endDate) {
      sendError(res, 'Code9004', 400);
      return;
    }
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const vendorAny = vendor as any;
    if (typeof vendorAny.getTransactionsByHour !== 'function') {
      sendError(res, 'Code9003', 400);
      return;
    }
    const result = await vendorAny.getTransactionsByHour(String(startDate), String(endDate), { nextId: nextId ? String(nextId) : undefined });

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to get transactions' });
  }
};

export const getTransactionsByMinute = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId } = req.params;
    const { startDate, endDate, nextId } = req.query;

    if (!startDate || !endDate) {
      sendError(res, 'Code9004', 400);
      return;
    }
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const vendorAny = vendor as any;
    if (typeof vendorAny.getTransactionsByMinute !== 'function') {
      sendError(res, 'Code9003', 400);
      return;
    }
    const result = await vendorAny.getTransactionsByMinute(String(startDate), String(endDate), { nextId: nextId ? String(nextId) : undefined });

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to get transactions' });
  }
};

/**
 * Get win/loss report
 * GET /api/games/:gameId/vendor/winloss
 */
export const getWinloss = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId } = req.params;
    const { startDate, endDate, username } = req.query;

    if (!startDate || !endDate) {
      sendError(res, 'Code9004', 400);
      return;
    }
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const vendorAny = vendor as any;
    if (typeof vendorAny.getWinloss !== 'function') {
      sendError(res, 'Code9003', 400);
      return;
    }
    const result = await vendorAny.getWinloss(String(startDate), String(endDate), username ? String(username) : undefined);

    sendSuccess(res, 'Code1', { winloss: result });
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to get winloss data' });
  }
};

/**
 * Get history URL
 * GET /api/games/:gameId/vendor/history
 */
export const getHistoryUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId } = req.params;
    const { ocode, language } = req.query;

    if (!ocode) {
      sendError(res, 'Code9004', 400);
      return;
    }
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const vendorAny = vendor as any;
    if (typeof vendorAny.getHistoryUrl !== 'function') {
      sendError(res, 'Code9003', 400);
      return;
    }
    const result = await vendorAny.getHistoryUrl(String(ocode), language ? String(language) : undefined);

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to get history URL' });
  }
};

// ==================== Jackpot ====================

/**
 * Get jackpot amount
 * GET /api/games/:gameId/vendor/jackpot
 */
export const getJackpot = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId } = req.params;
    const vendor = await getVendor(req, Number(gameId), res);
    if (!vendor) return;

    const vendorAny = vendor as any;
    if (typeof vendorAny.getJackpot !== 'function') {
      sendError(res, 'Code9003', 400);
      return;
    }
    const result = await vendorAny.getJackpot();

    sendSuccess(res, 'Code1', result);
  } catch (error: any) {
    sendError(res, 'Code9000', 500, { detail: error.message || 'Failed to get jackpot' });
  }
};

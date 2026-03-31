import { Request, Response } from 'express';
import { Transaction, BankAccount, Player, Role, SubBrand, User, Game, PlayerStats, GameAdjustment, BankCatalog, Product } from '../models';
import { AuthRequest } from '../middleware/auth';
import sequelize from '../config/database';
import { logAudit } from '../services/AuditService';
import { VendorFactory } from '../services/vendor/VendorFactory';
import { getTransactionAmounts } from '../services/transactions/transaction-amounts';
import { Op } from 'sequelize';
import { sanitizePlayerForResponse } from './PlayerController';
import { sanitizeBankAccountForResponse } from './BankAccountController';
import { decrypt, isEncrypted } from '../utils/encryption';
import { sendSuccess, sendError } from '../utils/response';
import { getTenancyScopeOrThrow, withTenancyCreate, withTenancyWhere } from '../tenancy/scope';

let transactionSynced = false;
const ensureTransactionsSynced = async () => {
  if (transactionSynced) return;
  try {
    await Transaction.sync({ alter: true });
  } catch {
  }
  transactionSynced = true;
};

const toFiniteNumber = (v: any): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const normalizeIp = (ip: string | null | undefined): string | null => {
	if (!ip) return null;
	if (ip === '::1') return '127.0.0.1';
	if (ip.startsWith('::ffff:')) return ip.substring(7);
	return ip;
};

const getClientIp = (req: Request): string | null => {
	const forwarded = req.headers['x-forwarded-for'];
	if (typeof forwarded === 'string' && forwarded.length > 0) {
		const first = forwarded.split(',')[0].trim();
		const normalized = normalizeIp(first);
		if (normalized) return normalized;
	}
	const remote = req.socket.remoteAddress || null;
	return normalizeIp(remote);
};

const resolveOperatorName = (op: any): string | null => {
  if (!op || typeof op !== 'object') return null;

  const rawFullName =
    typeof op.full_name === 'string' && op.full_name.trim().length > 0
      ? op.full_name.trim()
      : null;

  const rawUsername =
    typeof op.username === 'string' && op.username.trim().length > 0
      ? op.username.trim()
      : null;

  if (rawFullName) {
    if (isEncrypted(rawFullName)) {
      const decrypted = decrypt(rawFullName);
      return decrypted !== rawFullName ? decrypted : rawUsername;
    }
    return rawFullName;
  }

  return rawUsername;
};

const getPendingReservedWithdrawalByBank = async (tenancy: { tenant_id: number; sub_brand_id: number }, tx?: any) => {
  const rows = (await Transaction.findAll({
    attributes: [
      'bank_account_id',
      [sequelize.fn('SUM', sequelize.col('amount')), 'reserved'],
    ],
    where: withTenancyWhere(tenancy, {
      status: 'PENDING',
      type: 'WITHDRAWAL',
      bank_account_id: { [Op.ne]: null },
    }),
    group: ['bank_account_id'],
    raw: true,
    transaction: tx,
  } as any)) as any[];

  const map: Record<number, number> = {};
  for (const r of rows) {
    const id = Number(r.bank_account_id);
    if (!Number.isFinite(id)) continue;
    const v = r.reserved != null ? Number(r.reserved) : 0;
    map[id] = Number.isFinite(v) ? v : 0;
  }
  return map;
};

const getPendingReservedDepositByGame = async (tenancy: { tenant_id: number; sub_brand_id: number }, tx?: any) => {
  const rows = (await Transaction.findAll({
    attributes: [
      'game_id',
      [sequelize.fn('SUM', sequelize.literal('amount + bonus')), 'reserved'],
    ],
    where: withTenancyWhere(tenancy, {
      status: 'PENDING',
      type: 'DEPOSIT',
      game_id: { [Op.ne]: null },
    }),
    group: ['game_id'],
    raw: true,
    transaction: tx,
  } as any)) as any[];

  const map: Record<number, number> = {};
  for (const r of rows) {
    const id = Number(r.game_id);
    if (!Number.isFinite(id)) continue;
    const v = r.reserved != null ? Number(r.reserved) : 0;
    map[id] = Number.isFinite(v) ? v : 0;
  }
  return map;
};

const shapeTransactionsForResponse = (transactions: any[], userPermissions: string[]) => {
  const canViewProfit = userPermissions.includes('view:player_profit');

  return transactions.map((tx: any) => {
    const json = tx.toJSON();

    if (json.created_at && !json.createdAt) {
      json.createdAt = json.created_at;
    }

    if (json.Player) {
      if (json.Player.player_game_id && !json.Player.gameId) {
        json.Player.gameId = json.Player.player_game_id;
      }

      json.Player = sanitizePlayerForResponse(json.Player, userPermissions);
    }

    const bonus = json.bonus;
    const remark = json.remark;
    const ip = json.ip_address || null;
    const gameName = json.Game?.name || (json.Player?.Game?.name ?? null);
    const gameAccountId = json.game_account_id ?? json.Player?.player_game_id ?? null;

    delete json.ip_address;

    const op = json.operator || json.Operator || null;
    const operatorName = resolveOperatorName(op);
    json.operator = operatorName ? { id: op?.id ?? null, full_name: operatorName } : null;

    if (!canViewProfit) {
      json.amount = null;
      json.bonus = null;
      // walve字段不受权限检查限制，因为Recent Transactions需要显示
    }

    json.bonus = bonus;
    json.remark = remark;
    json.ip = ip;
    json.game_name = gameName;
    json.game_account_id = gameAccountId;
    json.message = json.vendor_message ?? null;
    json.credit_before = json.vendor_credit_before ?? null;
    json.credit_after = json.vendor_credit_after ?? null;
    
    // 确保walve字段被包含
    json.walve = json.walve ?? 0;

    return json;
  });
};

export const getTransactions = async (req: AuthRequest, res: Response) => {
  try {
    await ensureTransactionsSynced();
    const tenancy = getTenancyScopeOrThrow(req);
    const userPermissions = req.user?.permissions || [];
    const scope = (req.query.scope as string | undefined) || null;

    const where: any = {};
    if (scope === 'history') {
      where.type = { [Op.ne]: 'ADJUSTMENT' };
    }

    const transactions = await Transaction.findAll({
      where: withTenancyWhere(tenancy, where),
      include: [
        { 
          model: Player,
          required: false,
          where: withTenancyWhere(tenancy) as any,
          include: [{ model: Game, required: false, where: withTenancyWhere(tenancy) as any }]
        },
        { model: Game, required: false, where: withTenancyWhere(tenancy) as any },
        { model: BankAccount, required: false, where: withTenancyWhere(tenancy) as any },
        { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] }
      ],
      order: [['created_at', 'DESC']],
      limit: 100
    });

    const shaped = shapeTransactionsForResponse(transactions, userPermissions);

    sendSuccess(res, 'Code1', shaped);
  } catch (error) {
    sendError(res, 'Code311', 500); // Failed to fetch transaction context
  }
};

export const getPlayerTransactionHistory = async (req: AuthRequest, res: Response) => {
  try {
    await ensureTransactionsSynced();
    const tenancy = getTenancyScopeOrThrow(req);
    const userPermissions = req.user?.permissions || [];

    const playerIdRaw = (req.query.player_id as string | undefined) ?? (req.query.playerId as string | undefined);
    if (!playerIdRaw) {
      sendError(res, 'Code304', 400); // player_id is required
      return;
    }

    const playerId = parseInt(playerIdRaw, 10);
    if (!Number.isFinite(playerId) || playerId <= 0) {
      sendError(res, 'Code305', 400); // Invalid player_id
      return;
    }

    const limitRaw = req.query.limit as string | undefined;
    let limit = 10;
    if (limitRaw) {
      const parsed = parseInt(limitRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, 50);
      }
    }

    const transactions = await Transaction.findAll({
      where: {
        ...withTenancyWhere(tenancy, {
          player_id: playerId,
          type: { [Op.ne]: 'ADJUSTMENT' },
        }),
      },
      include: [
        { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] },
      ],
      order: [['created_at', 'DESC']],
      limit,
    });

    const payload = (transactions as any[]).map((tx) => {
      const json = tx.toJSON();
      const createdAt = json.createdAt ?? json.created_at ?? null;

      const amount: number | null =
        json.amount != null ? Number(json.amount) : null;

      const op = json.operator || json.Operator || null;
      const opFullName = resolveOperatorName(op);

      return {
        id: json.id,
        type: json.type,
        amount,
        status: json.status ?? null,
        createdAt,
        operator: opFullName ? { full_name: opFullName } : null,
      };
    });

    sendSuccess(res, 'Code1', payload);
  } catch (error) {
    sendError(res, 'Code312', 500); // Failed to fetch player transaction history
  }
};

export const getTransactionsContext = async (req: AuthRequest, res: Response) => {
  try {
    const tenancy = getTenancyScopeOrThrow(req);
    const userPermissions = req.user?.permissions || [];
    const scope = (req.query.scope as string | undefined) || null;

    if (scope === 'kiosk') {
      const startRaw = (req.query.startDate as string | undefined) ?? (req.query.start_date as string | undefined) ?? null;
      const endRaw = (req.query.endDate as string | undefined) ?? (req.query.end_date as string | undefined) ?? null;

      // Helper to parse "yyyy-MM-dd HH:mm:ss" as GMT+8
      const parseDateParam = (val: string) => {
        let s = val.trim();
        // If it looks like "yyyy-MM-dd HH:mm:ss", treat as GMT+8
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
          s = s.replace(' ', 'T') + '+08:00';
        }
        return new Date(s);
      };

      const now = new Date();
      // Default to today 00:00:00 - 23:59:59 GMT+8 if possible, or just local server time
      // But better to use what we have or rely on frontend sending defaults
      let startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      if (startRaw) {
        const parsed = parseDateParam(startRaw);
        if (!Number.isNaN(parsed.getTime())) {
          startDate = parsed;
        }
      }
      if (endRaw) {
        const parsed = parseDateParam(endRaw);
        if (!Number.isNaN(parsed.getTime())) {
          endDate = parsed;
        }
      }

      const txWhere: any = {
        status: 'COMPLETED',
        created_at: { [Op.between]: [startDate, endDate] },
        type: { [Op.in]: ['DEPOSIT', 'WITHDRAWAL', 'WALVE', 'BURN'] },
      };

      const txPermissions = Array.from(new Set([...userPermissions, 'view:player_profit']));
      const canViewUsers = userPermissions.includes('action:user_view');

      const [transactions, gamesRaw, adjustmentsRaw] = await Promise.all([
        Transaction.findAll({
          where: withTenancyWhere(tenancy, txWhere),
          include: [
            {
              model: Player,
              required: false,
              where: withTenancyWhere(tenancy) as any,
              include: [{ model: Game, required: false, where: withTenancyWhere(tenancy) as any }],
            },
            { model: Game, required: false, where: withTenancyWhere(tenancy) as any },
            { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] },
          ],
          order: [['created_at', 'DESC']],
          limit: 1000,
        } as any),
        Game.findAll({
          where: withTenancyWhere(tenancy, { status: 'active' }),
          order: [['name', 'ASC']],
        } as any),
        GameAdjustment.findAll({
          where: withTenancyWhere(tenancy, { createdAt: { [Op.between]: [startDate, endDate] } } as any),
          order: [['createdAt', 'DESC']],
        } as any),
      ]);
      
      const allOperators = canViewUsers ? await User.findAll({
        attributes: ['id', 'username', 'full_name'],
        where: withTenancyWhere(tenancy, { status: 'active' } as any),
        order: [['username', 'ASC']],
      }) : [];
      
      let operatorOptions: any[] = [];
      if (canViewUsers) {
        operatorOptions = (allOperators as any[])
          .map((u) => {
            const name = resolveOperatorName(u);
            return name ? { id: u.id, name } : null;
          })
          .filter(Boolean);
      } else if (req.user) {
         const name = resolveOperatorName(req.user);
         if (name) {
            operatorOptions = [{ id: req.user.id, name }];
         }
      }

      const shapedTransactions = shapeTransactionsForResponse(
        transactions as any[],
        txPermissions,
      ).map(
        (t: any) => {
          const type = t.type as string;
          const baseAmount = t.amount != null ? Number(t.amount) : 0;
          const bonusNum = Number((t as any).bonus ?? 0);
          const walveNum = Number((t as any).walve ?? 0);
          const tipsNum = Number((t as any).tips ?? 0);
          const gameAfterRaw = (t as any).game_balance_after;

          let gameAfter: number | null = null;
          let gameBefore: number | null = null;
          let signedForGame = 0;
          let kioskTotal = baseAmount;

          if (type === 'DEPOSIT') {
            const r = getTransactionAmounts({
              type: 'DEPOSIT',
              amount: baseAmount,
              bonus: bonusNum,
              walve: 0,
              tips: 0,
            });
            signedForGame = r.gameDelta;
            kioskTotal = r.displayTotal;
          } else if (type === 'WITHDRAWAL') {
            const r = getTransactionAmounts({
              type: 'WITHDRAWAL',
              amount: baseAmount,
              bonus: 0,
              walve: walveNum,
              tips: tipsNum,
            });
            signedForGame = r.gameDelta;
            kioskTotal = r.displayTotal;
          } else if (type === 'WALVE') {
            const r = getTransactionAmounts({
              type: 'WALVE',
              amount: 0,
              bonus: 0,
              walve: walveNum,
              tips: 0,
            });
            signedForGame = r.gameDelta;
            kioskTotal = r.displayTotal;
          } else if (type === 'BURN') {
            signedForGame = baseAmount;
            kioskTotal = baseAmount;
          }

          if (gameAfterRaw != null) {
            gameAfter = Number(gameAfterRaw);
            gameBefore = gameAfter - signedForGame;
          }

          const createdAt = t.createdAt ?? t.created_at ?? null;
          const playerGameId = t.Player?.player_game_id ?? t.player_game_id ?? null;

          const directGame = t.Game;
          const nestedGame = t.Player?.Game;
          const gameId = t.game_id ?? directGame?.id ?? nestedGame?.id ?? null;
          const gameName = directGame?.name ?? nestedGame?.name ?? t.game_name ?? null;

          const op = t.operator || t.Operator || null;
          const opFullName = resolveOperatorName(op);

          const remark =
            (t as any).remark ??
            (t as any).staff_note ??
            null;

          return {
            id: t.id,
            createdAt,
            type: t.type,
            amount: baseAmount,
            bonus: bonusNum,
            walve: walveNum,
            tips: tipsNum,
            kiosk_total: kioskTotal,
            status: t.status ?? null,
            game_id: gameId,
            Player: playerGameId
              ? {
                  id: t.player_id ?? null,
                  player_game_id: playerGameId,
                  Game: gameId && gameName ? { id: gameId, name: gameName } : undefined,
                }
              : null,
            operator: opFullName ? { id: t.operator_id ?? null, full_name: opFullName } : null,
            staff_note: remark,
            game_balance_before: gameBefore,
            game_balance_after: gameAfter,
          };
        },
      );

      const games = (gamesRaw as any[]).map((g: any) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        balance: typeof g.balance === 'number' ? g.balance : Number(g.balance ?? 0),
      }));

      const gameIconMap: Record<string, string | null> = {};
      for (const g of gamesRaw as any[]) {
        if (!g || !g.name) continue;
        gameIconMap[g.name] = g.icon || null;
      }

      const gameAdjustments = (adjustmentsRaw as any[]).map((a: any) => {
        const amount = a.amount != null ? Number(a.amount) : 0;
        const afterBalance =
          a.game_balance_after != null ? Number(a.game_balance_after) : null;

        let beforeBalance: number | null = null;
        if (afterBalance != null && !Number.isNaN(amount)) {
          if (a.type === 'TOPUP') {
            beforeBalance = afterBalance - amount;
          } else if (a.type === 'OUT') {
            beforeBalance = afterBalance + amount;
          }
        }

        return {
          id: a.id,
          gameId: a.game_id,
          amount,
          type: a.type,
          reason: a.reason,
          operator: a.operator,
          ip: a.ip_address ?? null,
          beforeBalance,
          afterBalance,
          date: a.createdAt,
        };
      });

      let subBrandOptions: any[] = [];
      try {
        const requesterId = req.user?.id;
        const requester: any = requesterId
          ? await User.findByPk(requesterId, { include: [{ model: Role, through: { attributes: [] }, required: false }] } as any)
          : null;
        if (requester) {
          const isSuperAdmin =
            Boolean(req.user?.is_super_admin) ||
            Boolean(requester?.Roles?.some((r: any) => String(r?.name ?? '').toLowerCase() === 'super admin'));
          const isOperator = Boolean(requester?.Roles?.some((r: any) => String(r?.name ?? '').toLowerCase() === 'operator'));

          let rows: any[] = [];
          if (isSuperAdmin) {
            rows = await SubBrand.findAll({ order: [['id', 'ASC']] });
          } else if (isOperator) {
            const tid = Number(requester?.tenant_id ?? null);
            if (Number.isFinite(tid) && tid > 0) {
              rows = await SubBrand.findAll({ where: { tenant_id: tid } as any, order: [['id', 'ASC']] });
            }
          } else {
            const sbid = Number(req.user?.sub_brand_id ?? requester?.sub_brand_id ?? null);
            if (Number.isFinite(sbid) && sbid > 0) {
              rows = await SubBrand.findAll({ where: { id: sbid } as any, order: [['id', 'ASC']] });
            }
          }

          subBrandOptions = (rows as any[]).map((sb) => ({
            id: sb.id,
            tenant_id: (sb as any).tenant_id ?? null,
            code: (sb as any).code ?? null,
            name: (sb as any).name ?? null,
            status: (sb as any).status ?? null,
          }));
        }
      } catch {
      }

      return sendSuccess(res, 'Code1', {
        generatedAt: new Date().toISOString(),
        games,
        gameIconMap,
        transactions: shapedTransactions,
        gameAdjustments,
        operatorOptions,
        subBrandOptions,
      });
    }

    if (scope === 'history') {
      const pageRaw = req.query.page as string | undefined;
      const pageSizeRaw = req.query.pageSize as string | undefined;
      let page = parseInt(pageRaw || '1', 10);
      if (!Number.isFinite(page) || page < 1) page = 1;
      let pageSize = parseInt(pageSizeRaw || '50', 10);
      if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 50;
      if (pageSize > 200) pageSize = 200;
      const offset = (page - 1) * pageSize;

      const where: any = {
        type: { [Op.ne]: 'ADJUSTMENT' },
      };

      const startRaw = req.query.startDate as string | undefined;
      const endRaw = req.query.endDate as string | undefined;
      
      // Helper to parse "yyyy-MM-dd HH:mm:ss" as GMT+8
      const parseDateParam = (val: string) => {
        let s = val.trim();
        // If it looks like "yyyy-MM-dd HH:mm:ss", treat as GMT+8
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
          s = s.replace(' ', 'T') + '+08:00';
        }
        return new Date(s);
      };

      const qRaw = (req.query.q as string | undefined)?.trim() || '';
      const searchType = ((req.query.searchType as string | undefined) || '').trim();
      const hasTextSearch = qRaw.length > 0;

      {
        const range: any = {};
        let hasRange = false;
        if (startRaw) {
          const d = parseDateParam(startRaw);
          if (!Number.isNaN(d.getTime())) {
            range[Op.gte] = d;
            hasRange = true;
          }
        }
        if (endRaw) {
          const d = parseDateParam(endRaw);
          if (!Number.isNaN(d.getTime())) {
            range[Op.lte] = d;
            hasRange = true;
          }
        }
        const hasInlineFilters =
          ((req.query.operatorId as string | undefined)?.trim() || '') ||
          ((req.query.type as string | undefined)?.trim() || '') ||
          ((req.query.status as string | undefined)?.trim() || '');

        if (hasTextSearch) {
          // Text search:
          // Only Transaction ID is NOT constrained by date unless user provided one
          const st = (searchType || '').toLowerCase();
          if (st === 'transaction_id') {
            // ignore date range entirely
          } else if (hasRange) {
            // user provided explicit date -> respect
            where.created_at = range;
          } else {
            // no explicit date -> default to TODAY for other search types
            const now = new Date();
            const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            where.created_at = { [Op.gte]: startToday, [Op.lte]: endToday };
          }
        } else if (hasRange) {
          // Date provided: use given range
          where.created_at = range;
        } else {
          // No date provided:
          // - If inline filters present (Operator/Type/Status), default to TODAY
          // - If no filters and no text search, also default to TODAY
          if (hasInlineFilters || !hasTextSearch) {
            const now = new Date();
            const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            where.created_at = { [Op.gte]: startToday, [Op.lte]: endToday };
          }
        }
      }

      // Fetch base dataset; we'll apply precise filtering in memory (handles decrypted fields)
      const rows = await Transaction.findAll({
        where: withTenancyWhere(tenancy, where),
        include: [
          {
            model: Player,
            required: false,
            where: withTenancyWhere(tenancy) as any,
            include: [{ model: Game, required: false, where: withTenancyWhere(tenancy) as any }],
          },
          { model: Game, required: false, where: withTenancyWhere(tenancy) as any },
          { model: BankAccount, required: false, where: withTenancyWhere(tenancy) as any },
          { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] },
        ],
        order: [['created_at', 'DESC']],
      } as any);

      const txPermissions = Array.from(
        new Set<string>([...userPermissions, 'view:player_profit']),
      );

      // Precise in-memory filtering consistent with Player Management
      const normalizeDigits = (s: string) => String(s || '').replace(/\D/g, '');
      const qLower = qRaw.toLowerCase();
      const qDigits = normalizeDigits(qRaw);
      const operatorIdRaw = (req.query.operatorId as string | undefined)?.trim() || '';
      const typeFilter = (req.query.type as string | undefined)?.trim() || '';
      const statusFilter = (req.query.status as string | undefined)?.trim() || '';
      const operatorIdNum =
        operatorIdRaw && !Number.isNaN(Number(operatorIdRaw)) ? Number(operatorIdRaw) : null;

      const filteredRows = (rows as any[]).filter((t) => {
        // Apply dropdown filters regardless of text search
        if (operatorIdNum != null) {
          const opId = t?.operator?.id ?? t?.Operator?.id ?? null;
          if (opId !== operatorIdNum) return false;
        }
        if (typeFilter) {
          const type = String(t?.type ?? '').toUpperCase();
          if (type !== typeFilter.toUpperCase()) return false;
        }
        if (statusFilter) {
          const status = String(t?.status ?? '').toUpperCase();
          if (status !== statusFilter.toUpperCase()) return false;
        }

        if (!hasTextSearch) return true;
        const txId = String(t?.id ?? '').toLowerCase();
        const status = String(t?.status ?? '').toLowerCase();
        const type = String(t?.type ?? '').toLowerCase();
        const playerGameId = String(t?.Player?.player_game_id ?? '').toLowerCase();
        const gameAccountId = String(t?.game_account_id ?? '').toLowerCase();
        const ip = normalizeIp(String(t?.ip_address ?? ''))?.toLowerCase() || '';
        const operatorName = resolveOperatorName(t?.operator || t?.Operator || null);
        const operatorLower = String(operatorName ?? '').toLowerCase();

        const st = searchType || 'transaction_id';
        if (st === 'transaction_id') return txId.includes(qLower);
        if (st === 'status') return status.includes(qLower);
        if (st === 'game_id') return gameAccountId.includes(qLower);
        if (st === 'type') return type.includes(qLower);
        if (st === 'operator') return operatorLower.includes(qLower);
        if (st === 'player_id') return playerGameId.includes(qLower);
        if (st === 'ip') return ip.includes(qLower);

        return (
          txId.includes(qLower) ||
          playerGameId.includes(qLower) ||
          gameAccountId.includes(qLower) ||
          operatorLower.includes(qLower) ||
          ip.includes(qLower) ||
          status.includes(qLower) ||
          type.includes(qLower)
        );
      });

      const total = filteredRows.length;
      const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 1;
      if (page > totalPages && totalPages > 0) page = totalPages;
      const startIndex = (page - 1) * pageSize;
      const pageRows =
        total === 0 ? [] : filteredRows.slice(startIndex, startIndex + pageSize);

      const shapedTransactions = shapeTransactionsForResponse(
        pageRows as any[],
        txPermissions,
      ).map((t: any) => {
        const amountNum = t.amount != null ? Number(t.amount) : 0;
        const type = t.type as string;
        const bankAfterRaw = (t as any).bank_balance_after;
        const gameAfterRaw = (t as any).game_balance_after;

        let bankAfter: number | null = null;
        let bankBefore: number | null = null;
        let gameAfter: number | null = null;
        let gameBefore: number | null = null;

        let signedForBank = 0;
        let signedForGame = 0;

        if (type === 'DEPOSIT') {
          signedForBank = amountNum;
          const walveDep = Number((t as any).bonus ?? 0);
          signedForGame = -(amountNum + walveDep);
        } else if (type === 'WITHDRAWAL') {
          signedForBank = -amountNum;
          const walveWd = Number((t as any).walve ?? 0);
          const tips = Number((t as any).tips ?? 0);
          signedForGame = amountNum + walveWd + tips;
        } else if (type === 'ADJUSTMENT') {
          signedForBank = amountNum;
        } else if (type === 'WALVE') {
          const walveOnly = Number((t as any).walve ?? 0);
          signedForGame = walveOnly;
        }

        if (bankAfterRaw != null) {
          bankAfter = Number(bankAfterRaw);
          bankBefore = bankAfter - signedForBank;
        }
        if (gameAfterRaw != null) {
          gameAfter = Number(gameAfterRaw);
          gameBefore = gameAfter - signedForGame;
        }

        return {
          ...t,
          bank_balance_after: bankAfter,
          bank_balance_before: bankBefore,
          game_balance_after: gameAfter,
          game_balance_before: gameBefore,
        };
      });

      const [bankAccounts, games, bankCatalog, reservedBankMap, reservedGameMap] = await Promise.all([
        BankAccount.findAll({ where: withTenancyWhere(tenancy) } as any),
        Game.findAll({
          where: withTenancyWhere(tenancy) as any,
          order: [['name', 'ASC']],
        }),
        BankCatalog.findAll({
          order: [['name', 'ASC']],
        }),
        getPendingReservedWithdrawalByBank(tenancy),
        getPendingReservedDepositByGame(tenancy),
      ]);

      const shapedBankAccountsFull = (bankAccounts as any[]).map((b) =>
        sanitizeBankAccountForResponse(b, userPermissions),
      );
      const shapedGamesFull = (games as any[]).map((g: any) => {
        const balance = Number(g.balance);
        const reserved = reservedGameMap[g.id] ?? 0;
        const available = Number.isFinite(balance) ? balance - Number(reserved || 0) : balance;
        return {
          id: g.id,
          name: g.name,
          icon: g.icon,
          status: g.status,
          balance,
          reserved_balance: Number(reserved || 0),
          available_balance: available,
        };
      });

      const gameIconMap: Record<string, string | null> = {};
      for (const g of games as any[]) {
        if (!g || !g.name) continue;
        gameIconMap[g.name] = g.icon || null;
      }

      const gameAppIdByNameLower = new Map<string, string>();
      for (const g of games as any[]) {
        const name = typeof g?.name === 'string' ? g.name.trim() : '';
        if (!name) continue;
        let cfg: any = (g as any).vendor_config;
        if (typeof cfg === 'string') {
          const s = cfg.trim();
          if (s.startsWith('{') || s.startsWith('[')) {
            try {
              cfg = JSON.parse(s);
            } catch {
              cfg = null;
            }
          } else {
            cfg = null;
          }
        }
        const appId = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? String((cfg as any).appId || '').trim() : '';
        if (!appId) continue;
        gameAppIdByNameLower.set(name.toLowerCase(), appId);
      }

      const bankIconMap: Record<string, string | null> = {};
      for (const bc of bankCatalog as any[]) {
        if (!bc || !bc.name) continue;
        bankIconMap[bc.name] = bc.icon || null;
      }

      const payloadTransactions = (shapedTransactions as any[]).map((t) => ({
        display_game_account_id: (() => {
          const gameName = String((t as any).game_name ?? '').trim().toLowerCase();
          const appId = gameName ? (gameAppIdByNameLower.get(gameName) ?? '') : '';
          const accountId = String((t as any).game_account_id ?? '').trim();
          if (!appId || !accountId) return null;
          return accountId.includes('.') ? accountId : `${appId}.${accountId}`;
        })(),
        id: t.id,
        createdAt: t.createdAt ?? t.created_at ?? null,
        type: t.type,
        amount: t.amount ?? null,
        bonus: t.bonus ?? null,
        walve: t.walve ?? null,
        tips: t.tips ?? null,
        credit_before: (t as any).credit_before ?? (t as any).vendor_credit_before ?? null,
        credit_after: (t as any).credit_after ?? (t as any).vendor_credit_after ?? null,
        bank_account_id: t.bank_account_id ?? null,
        player_id: t.player_id ?? null,
        player_game_id:
          (t as any).player_game_id ??
          (t as any).Player?.player_game_id ??
          null,
        game_name: t.game_name ?? null,
        game_account_id: t.game_account_id ?? null,
        remark: t.remark ?? null,
        status: t.status ?? null,
        ip: t.ip ?? null,
        operator: (() => {
          const fullName =
            typeof t.operator?.full_name === 'string' &&
            t.operator.full_name.trim().length > 0
              ? t.operator.full_name.trim()
              : null;
          return fullName ? { full_name: fullName } : null;
        })(),
      }));

      const payloadBankAccounts = (shapedBankAccountsFull as any[]).map((b) => ({
        id: b.id,
        bank_name: b.bank_name,
      }));

      const payloadGames = (shapedGamesFull as any[]).map((g) => ({
        id: g.id,
        name: g.name,
      }));

      const canViewUsers = userPermissions.includes('action:user_view');

      const allOperators = canViewUsers
        ? await User.findAll({
            attributes: ['id', 'username', 'full_name'],
            where: { tenant_id: tenancy.tenant_id, status: 'active' } as any,
            order: [['username', 'ASC']],
          } as any)
        : [];
      
      let operatorOptions: any[] = [];
      if (canViewUsers) {
        operatorOptions = (allOperators as any[])
          .map((u) => {
            const name = resolveOperatorName(u);
            return name ? { id: u.id, name } : null;
          })
          .filter(Boolean);
      } else if (req.user) {
        const name = resolveOperatorName(req.user);
        if (name) {
          operatorOptions = [{ id: req.user.id, name }];
        }
      }

      let subBrandOptions: any[] = [];
      try {
        const requesterId = req.user?.id;
        const requester: any = requesterId
          ? await User.findByPk(requesterId, { include: [{ model: Role, through: { attributes: [] }, required: false }] } as any)
          : null;
        if (requester) {
          const isSuperAdmin =
            Boolean(req.user?.is_super_admin) ||
            Boolean(requester?.Roles?.some((r: any) => String(r?.name ?? '').toLowerCase() === 'super admin'));
          const isOperator = Boolean(requester?.Roles?.some((r: any) => String(r?.name ?? '').toLowerCase() === 'operator'));

          let rows: any[] = [];
          if (isSuperAdmin) {
            rows = await SubBrand.findAll({ order: [['id', 'ASC']] });
          } else if (isOperator) {
            const tid = Number(requester?.tenant_id ?? null);
            if (Number.isFinite(tid) && tid > 0) {
              rows = await SubBrand.findAll({ where: { tenant_id: tid } as any, order: [['id', 'ASC']] });
            }
          } else {
            const sbid = Number(req.user?.sub_brand_id ?? requester?.sub_brand_id ?? null);
            if (Number.isFinite(sbid) && sbid > 0) {
              rows = await SubBrand.findAll({ where: { id: sbid } as any, order: [['id', 'ASC']] });
            }
          }

          subBrandOptions = (rows as any[]).map((sb) => ({
            id: sb.id,
            tenant_id: (sb as any).tenant_id ?? null,
            code: (sb as any).code ?? null,
            name: (sb as any).name ?? null,
            status: (sb as any).status ?? null,
          }));
        }
      } catch (e) {
        void e;
      }

      const shapedBankAccountsWithAvailability = (shapedBankAccountsFull as any[]).map((b: any) => {
        const total = typeof b.total_balance === 'number' ? Number(b.total_balance) : null;
        if (total == null) {
          return { ...b, reserved_balance: null, available_balance: null };
        }
        const reserved = reservedBankMap[b.id] ?? 0;
        return {
          ...b,
          reserved_balance: Number(reserved || 0),
          available_balance: total - Number(reserved || 0),
        };
      });

      sendSuccess(res, 'Code1', {
        transactions: payloadTransactions,
        games: shapedGamesFull,
        gameIconMap,
        bankAccounts: shapedBankAccountsWithAvailability,
        bankIconMap,
        pagination: {
          page,
          pageSize,
          totalItems: total,
          totalPages,
        },
        operatorOptions,
        subBrandOptions,
      });
      return;
    }

    const where: any = {};

    const [transactions, bankAccounts, games, reservedBankMap, reservedGameMap] = await Promise.all([
      Transaction.findAll({
        where: withTenancyWhere(tenancy, where),
        include: [
          {
            model: Player,
            required: false,
            where: withTenancyWhere(tenancy) as any,
            include: [{ model: Game, required: false, where: withTenancyWhere(tenancy) as any }],
          },
          { model: Game, required: false, where: withTenancyWhere(tenancy) as any },
          { model: BankAccount, required: false, where: withTenancyWhere(tenancy) as any },
          { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] },
        ],
        order: [['created_at', 'DESC']],
        limit: 5,
      }),
      BankAccount.findAll({ where: withTenancyWhere(tenancy) } as any),
      Game.findAll({
        where: withTenancyWhere(tenancy, { status: 'active' }),
        order: [['name', 'ASC']]
      }),
      getPendingReservedWithdrawalByBank(tenancy),
      getPendingReservedDepositByGame(tenancy),
    ]);

    const txPermissions = userPermissions;

    const shapedTransactions = shapeTransactionsForResponse(transactions as any[], txPermissions).map(
      (t: any) => {
        const amountNum = t.amount != null ? Number(t.amount) : 0;
        const type = t.type as string;
        const bankAfterRaw = (t as any).bank_balance_after;
        const gameAfterRaw = (t as any).game_balance_after;

        let bankAfter: number | null = null;
        let bankBefore: number | null = null;
        let gameAfter: number | null = null;
        let gameBefore: number | null = null;

        let signedForBank = 0;
        let signedForGame = 0;

        if (type === 'DEPOSIT') {
          signedForBank = amountNum;
          const walveDep = Number((t as any).bonus ?? 0);
          signedForGame = -(amountNum + walveDep);
        } else if (type === 'WITHDRAWAL') {
          signedForBank = -amountNum;
          const walveWd = Number((t as any).walve ?? 0);
          const tips = Number((t as any).tips ?? 0);
          signedForGame = amountNum + walveWd + tips;
        } else if (type === 'ADJUSTMENT') {
          signedForBank = amountNum;
        } else if (type === 'WALVE') {
          const walveOnly = Number((t as any).walve ?? 0);
          signedForGame = walveOnly;
        }

        if (bankAfterRaw != null) {
          bankAfter = Number(bankAfterRaw);
          bankBefore = bankAfter - signedForBank;
        }
        if (gameAfterRaw != null) {
          gameAfter = Number(gameAfterRaw);
          gameBefore = gameAfter - signedForGame;
        }

        return {
          ...t,
          bank_balance_after: bankAfter,
          bank_balance_before: bankBefore,
          game_balance_after: gameAfter,
          game_balance_before: gameBefore,
        };
      },
    );
    const shapedBankAccountsFull = (bankAccounts as any[]).map((b) =>
      sanitizeBankAccountForResponse(b, userPermissions),
    );
    const shapedBankAccountsWithAvailability = (shapedBankAccountsFull as any[]).map((b: any) => {
      const total = typeof b.total_balance === 'number' ? Number(b.total_balance) : null;
      if (total == null) {
        return { ...b, reserved_balance: null, available_balance: null };
      }
      const reserved = reservedBankMap[b.id] ?? 0;
      return {
        ...b,
        reserved_balance: Number(reserved || 0),
        available_balance: total - Number(reserved || 0),
      };
    });
    const shapedGamesFull = (games as any[]).map((g: any) => {
      const balance = Number(g.balance);
      const reserved = reservedGameMap[g.id] ?? 0;
      const available = Number.isFinite(balance) ? balance - Number(reserved || 0) : balance;
      return {
        id: g.id,
        name: g.name,
        icon: g.icon,
        status: g.status,
        balance,
        reserved_balance: Number(reserved || 0),
        available_balance: available,
      };
    });

    const payloadTransactions =
      scope === 'history'
        ? (shapedTransactions as any[]).map((t) => ({
            id: t.id,
            createdAt: t.createdAt ?? t.created_at ?? null,
            type: t.type,
            amount: t.amount ?? null,
            bonus: t.bonus ?? null,
            walve: t.walve ?? null,
            tips: t.tips ?? null,
            credit_before: (t as any).credit_before ?? (t as any).vendor_credit_before ?? null,
            credit_after: (t as any).credit_after ?? (t as any).vendor_credit_after ?? null,
            bank_account_id: t.bank_account_id ?? null,
            player_id: t.player_id ?? null,
            game_name: t.game_name ?? null,
            game_account_id: t.game_account_id ?? null,
            remark: t.remark ?? null,
            status: t.status ?? null,
            ip: t.ip ?? null,
            operator: (() => {
              const fullName =
                typeof t.operator?.full_name === 'string' &&
                t.operator.full_name.trim().length > 0
                  ? t.operator.full_name.trim()
                  : null;
              return fullName ? { full_name: fullName } : null;
            })(),
          }))
        : (shapedTransactions as any[]).map((t) => {
            const baseAmount = Number(t.amount ?? 0);
            const bonus = Number(t.bonus ?? 0);
            const walve = Number(t.walve ?? 0);
            const tips = Number(t.tips ?? 0);
            
            let calculatedAmount = 0;
            if (t.type === 'DEPOSIT') {
                calculatedAmount = baseAmount + bonus;
            } else if (t.type === 'WITHDRAWAL') {
                calculatedAmount = baseAmount + walve + tips;
            } else if (t.type === 'WALVE') {
                calculatedAmount = walve;
            } else {
                calculatedAmount = baseAmount;
            }
            
            return {
                id: t.id,
                type: t.type,
                game_name: t.game_name ?? null,
                createdAt: t.createdAt ?? t.created_at ?? null,
                status: t.status ?? null,
                player_game_id: t.Player?.player_game_id ?? t.player_game_id ?? null,
                amount: calculatedAmount,
                walve: t.walve ?? null,
                bonus: t.bonus ?? null,
                tips: t.tips ?? null,
            };
        });

    const payloadBankAccounts =
      scope === 'history'
        ? (shapedBankAccountsFull as any[]).map((b) => ({
            id: b.id,
            bank_name: b.bank_name,
          }))
        : shapedBankAccountsWithAvailability;

    const payloadGames =
      scope === 'history'
        ? (shapedGamesFull as any[]).map((g) => ({
            id: g.id,
            name: g.name,
          }))
        : shapedGamesFull;

    let subBrandOptions: any[] = [];
    try {
      const requesterId = req.user?.id;
      const requester: any = requesterId
        ? await User.findByPk(requesterId, {
            attributes: ['id', 'username', 'full_name', 'tenant_id', 'sub_brand_id', 'is_super_admin'],
            include: [{ model: Role, through: { attributes: [] }, required: false }],
          } as any)
        : null;

      if (requester) {
        const isSuperAdmin =
          Boolean(req.user?.is_super_admin) ||
          Boolean(requester?.is_super_admin) ||
          Boolean(requester?.Roles?.some((r: any) => String(r?.name ?? '').toLowerCase() === 'super admin'));
        const isOperator = Boolean(requester?.Roles?.some((r: any) => String(r?.name ?? '').toLowerCase() === 'operator'));

        let rows: any[] = [];
        if (isSuperAdmin) {
          rows = await SubBrand.findAll({ order: [['id', 'ASC']] });
        } else if (isOperator) {
          const tid = Number(requester?.tenant_id ?? null);
          if (Number.isFinite(tid) && tid > 0) {
            rows = await SubBrand.findAll({ where: { tenant_id: tid } as any, order: [['id', 'ASC']] });
          }
        } else {
          const sbid = Number(req.user?.sub_brand_id ?? requester?.sub_brand_id ?? null);
          if (Number.isFinite(sbid) && sbid > 0) {
            rows = await SubBrand.findAll({ where: { id: sbid } as any, order: [['id', 'ASC']] });
          }
        }

        subBrandOptions = (rows as any[]).map((sb) => ({
          id: sb.id,
          tenant_id: (sb as any).tenant_id ?? null,
          code: (sb as any).code ?? null,
          name: (sb as any).name ?? null,
          status: (sb as any).status ?? null,
        }));
      }
    } catch (e) {
      void e;
    }

    sendSuccess(res, 'Code1', {
      transactions: payloadTransactions,
      bankAccounts: payloadBankAccounts,
      games: payloadGames,
      subBrandOptions,
    });
  } catch (error) {
    sendError(res, 'Code313', 500); // Failed to fetch transaction context
  }
};

export const createTransaction = async (req: AuthRequest, res: Response) => {
  let pendingTransaction: any | null = null;
  let ctxPlayerId: number | null = null;
  let ctxGameId: number | null = null;
  let ctxGameAccountId: string | null = null;
  try {
    await ensureTransactionsSynced();
    const clientIp = getClientIp(req);
    const tenancy = getTenancyScopeOrThrow(req);
    const { player_id, bank_account_id, type, amount, game_id, game_account_id } = req.body;
    ctxPlayerId = typeof player_id === 'number' ? player_id : (player_id ? Number(player_id) : null);
    ctxGameId = typeof game_id === 'number' ? game_id : (game_id ? Number(game_id) : null);
    ctxGameAccountId = typeof game_account_id === 'string' ? game_account_id : null;
    const bonusRaw = (req.body.bonus ?? 0) as number | string;
    const tipsRaw = (req.body.tips ?? 0) as number | string;
    const remark: string | null = (req.body.remark ?? req.body.staff_note ?? null) as string | null;
    const operator_id = req.user.id;
    const userPermissions = req.user.permissions || [];

    if (type === 'DEPOSIT' && !userPermissions.includes('action:deposit_create')) {
      sendError(res, 'Code301', 403);
      return;
    }
    if (type === 'WITHDRAWAL' && !userPermissions.includes('action:withdrawal_create')) {
      sendError(res, 'Code302', 403);
      return;
    }
    if (type === 'WALVE' && !userPermissions.includes('action:burn_create')) {
      sendError(res, 'Code303', 403);
      return;
    }

    const isDeposit = type === 'DEPOSIT';
    const isWithdrawal = type === 'WITHDRAWAL';
    const isWalve = type === 'WALVE';

    const amountRaw = parseFloat(amount ?? 0);
    const bonusAmount = parseFloat((bonusRaw as any) || 0);
    const walveAmount = parseFloat(((req.body.walve ?? 0) as any) || 0);
    const tipsAmount = parseFloat((tipsRaw as any) || 0);
    const effectiveGameId = game_id || null;

    const amountForType = isWalve ? 0 : amountRaw;
    const bonusForType = isDeposit ? bonusAmount : 0;
    const walveForType = isWithdrawal || isWalve ? walveAmount : 0;
    const tipsForType = isWithdrawal ? tipsAmount : 0;

    const amounts = getTransactionAmounts({
      type,
      amount: amountForType,
      bonus: bonusForType,
      walve: walveForType,
      tips: tipsForType,
    });

    const reserveBank = amounts.bankDelta < 0 ? -amounts.bankDelta : 0;
    const reserveGame = amounts.gameDelta < 0 ? -amounts.gameDelta : 0;

    const fmt = (n: number) => `$${Number(n).toFixed(2)}`;
    const insufficientFundsDetail = (available: number) => `Insufficient Funds ${fmt(available)}`;
    const balanceError = (code: 'T903' | 'T904', available: number) => {
      throw new Error(`BALANCE_ERR:${code}:${insufficientFundsDetail(available)}`);
    };

    const tReserve = await sequelize.transaction();
    let gameUseApi = false;
    try {
      const bankAccount =
        type === 'WALVE'
          ? null
          : await BankAccount.findOne({
              where: withTenancyWhere(tenancy, { id: bank_account_id } as any),
              transaction: tReserve,
              lock: tReserve.LOCK.UPDATE,
            } as any);
      if (type !== 'WALVE' && !bankAccount) {
        await tReserve.rollback();
        sendError(res, 'Code306', 400, { detail: 'Bank account not found' });
        return;
      }

      const gameLocked = effectiveGameId
        ? await Game.findOne({
            where: withTenancyWhere(tenancy, { id: effectiveGameId as any } as any),
            transaction: tReserve,
            lock: tReserve.LOCK.UPDATE,
          } as any)
        : null;
      if (!gameLocked) {
        await tReserve.rollback();
        sendError(res, 'Code307', 400, { detail: 'Game not found' });
        return;
      }

      gameUseApi = Boolean((gameLocked as any).use_api);

      if (reserveBank > 0 && bankAccount) {
        const reservedBankMap = await getPendingReservedWithdrawalByBank(tenancy, tReserve);
        const reservedExisting = Number(reservedBankMap[(bankAccount as any).id] ?? 0);
        const currentBalance = Number((bankAccount as any).total_balance);
        const available = currentBalance - reservedExisting;
        if (available < reserveBank) balanceError('T903', available);
      }
      if (reserveGame > 0) {
        const reservedGameMap = await getPendingReservedDepositByGame(tenancy, tReserve);
        const reservedExisting = Number(reservedGameMap[(gameLocked as any).id] ?? 0);
        const currentBalance = Number((gameLocked as any).balance);
        const available = currentBalance - reservedExisting;
        if (available < reserveGame) balanceError('T904', available);
      }

      pendingTransaction = await Transaction.create(
        withTenancyCreate(tenancy, {
          player_id,
          bank_account_id: type === 'WALVE' ? null : bank_account_id,
          game_id: effectiveGameId,
          game_account_id,
          operator_id,
          type,
          amount: amountForType,
          bonus: bonusForType,
          tips: tipsForType,
          walve: walveForType,
          remark,
          ip_address: clientIp,
          status: 'PENDING',
          bank_balance_after: null,
          game_balance_after: null,
        }),
        { transaction: tReserve },
      );

      await tReserve.commit();
    } catch (e) {
      if (!(tReserve as any).finished) await tReserve.rollback();
      throw e;
    }

    const requestId = String(pendingTransaction.id);
    let vendorUsername: string | null = null;
    let vendorCreditBefore: number | null = null;
    let vendorCreditAfter: number | null = null;

    if (gameUseApi) {
      const gameForVendor = effectiveGameId
        ? await Game.findOne({ where: withTenancyWhere(tenancy, { id: effectiveGameId as any } as any) } as any)
        : null;
      const vendor = gameForVendor ? await VendorFactory.getServiceByGame((gameForVendor as any).id) : null;
      if (vendor) {
        if (!game_account_id || typeof game_account_id !== 'string') {
          throw new Error('Game account is required for vendor transfer');
        }
        vendorUsername = game_account_id;
        let vendorOk = false;
        const throwApiError = (vendorMessage?: string) => {
          const e: any = new Error('API ERROR');
          if (vendorMessage) e.vendorMessage = vendorMessage;
          throw e;
        };
        const verifyIfSupported = async () => {
          if (!vendor.verifyTransfer) return false;
          const delaysMs = [0, 1500, 4000];
          for (let i = 0; i < delaysMs.length; i++) {
            const delay = delaysMs[i];
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
            try {
              const chk = await vendor.verifyTransfer(requestId);
              if (chk?.success) return true;
              const errMsg = (chk as any)?.error || (chk as any)?.message;
              const retry = vendor.shouldVerifyTransferOnError?.(errMsg) ?? false;
              if (!retry) return false;
            } catch (e: any) {
              const errMsg = String(e?.message ?? e ?? '');
              const retry = vendor.shouldVerifyTransferOnError?.(errMsg) ?? false;
              if (!retry) return false;
            }
          }
          return false;
        };

        let vendorMessageToPersist: string | null = null;
        if (type === 'DEPOSIT') {
          let vendorMessage: string | undefined;
          let needVerify = false;
          try {
            const v = await vendor.deposit(vendorUsername, amounts.vendorTransfer, requestId);
            vendorOk = !!v.success;
            vendorMessage = v.success ? (v.message || v.error || 'OK') : (v.error || v.message);
            if (v.success) {
              const before = toFiniteNumber((v as any).beforeCredit);
              const after = toFiniteNumber((v as any).credit);
              if (before != null) vendorCreditBefore = before;
              if (after != null) vendorCreditAfter = after;
            }
            if (!vendorOk) {
              needVerify = vendor.shouldVerifyTransferOnError?.(vendorMessage) ?? false;
            }
          } catch (e: any) {
            vendorOk = false;
            vendorMessage = String(e?.message ?? e ?? '');
            needVerify = vendor.shouldVerifyTransferOnError?.(vendorMessage) ?? true;
          }
          if (!vendorOk && needVerify) {
            vendorOk = await verifyIfSupported();
            if (vendorOk && !vendorMessage) vendorMessage = 'VERIFIED';
          }
          if (vendorOk && !vendorMessage) vendorMessage = 'OK';
          vendorMessageToPersist = vendorMessage || null;
          try {
            await Transaction.update(
              { vendor_message: vendorMessageToPersist, vendor_credit_before: vendorCreditBefore, vendor_credit_after: vendorCreditAfter },
              { where: { id: pendingTransaction.id } },
            );
            await pendingTransaction.reload();
          } catch {
          }
          if (!vendorOk) throwApiError(vendorMessage);
        } else if (type === 'WITHDRAWAL' || type === 'WALVE') {
          let vendorMessage: string | undefined;
          let needVerify = false;
          try {
            const v = await vendor.withdraw(vendorUsername, amounts.vendorTransfer, requestId);
            vendorOk = !!v.success;
            vendorMessage = v.success ? (v.message || v.error || 'OK') : (v.error || v.message);
            if (v.success) {
              const before = toFiniteNumber((v as any).beforeCredit);
              const after = toFiniteNumber((v as any).credit);
              if (before != null) vendorCreditBefore = before;
              if (after != null) vendorCreditAfter = after;
            }
            if (!vendorOk) {
              needVerify = vendor.shouldVerifyTransferOnError?.(vendorMessage) ?? false;
            }
          } catch (e: any) {
            vendorOk = false;
            vendorMessage = String(e?.message ?? e ?? '');
            needVerify = vendor.shouldVerifyTransferOnError?.(vendorMessage) ?? true;
          }
          if (!vendorOk && needVerify) {
            vendorOk = await verifyIfSupported();
            if (vendorOk && !vendorMessage) vendorMessage = 'VERIFIED';
          }
          if (vendorOk && !vendorMessage) vendorMessage = 'OK';
          vendorMessageToPersist = vendorMessage || null;
          try {
            await Transaction.update(
              { vendor_message: vendorMessageToPersist, vendor_credit_before: vendorCreditBefore, vendor_credit_after: vendorCreditAfter },
              { where: { id: pendingTransaction.id } },
            );
            await pendingTransaction.reload();
          } catch {
          }
          if (!vendorOk) throwApiError(vendorMessage);
        }
      }
    }

    const tFinal = await sequelize.transaction();
    try {
      const bankAccount = type === 'WALVE'
        ? null
        : await BankAccount.findOne({
            where: withTenancyWhere(tenancy, { id: bank_account_id } as any),
            transaction: tFinal,
            lock: tFinal.LOCK.UPDATE,
          } as any);
      if (type !== 'WALVE' && !bankAccount) {
        throw new Error('Bank account not found');
      }

      const player = await Player.findOne({ where: withTenancyWhere(tenancy, { id: player_id } as any), transaction: tFinal } as any);
      if (!player) {
        throw new Error('Player not found');
      }

      const gameLocked = effectiveGameId
        ? await Game.findOne({
            where: withTenancyWhere(tenancy, { id: effectiveGameId } as any),
            transaction: tFinal,
            lock: tFinal.LOCK.UPDATE,
          } as any)
        : null;
      if (!gameLocked) {
        throw new Error('Game not found');
      }

      if (vendorUsername && vendorCreditAfter != null && Number.isFinite(vendorCreditAfter)) {
        try {
          const meta: any = (player as any).metadata && typeof (player as any).metadata === 'object' ? (player as any).metadata : {};
          const accounts: any[] = Array.isArray(meta.gameAccounts) ? meta.gameAccounts : [];
          const gameName = String((gameLocked as any).name || '').trim();
          const normalizedGameName = gameName.toLowerCase();
          const normalizedVendorUsername = vendorUsername.trim().toLowerCase();

          const hasExactMatch = accounts.some((ga: any) => {
            const gaGameName = String(ga?.gameName || '').trim().toLowerCase();
            const gaAccountId = String(ga?.accountId || '').trim().toLowerCase();
            return gaGameName === normalizedGameName && gaAccountId === normalizedVendorUsername;
          });

          const nextAccounts = accounts.map((ga: any) => {
            const gaGameNameRaw = String(ga?.gameName || '').trim();
            if (!gaGameNameRaw) return ga;
            const gaGameName = gaGameNameRaw.toLowerCase();
            if (gaGameName !== normalizedGameName) return ga;

            if (hasExactMatch) {
              const gaAccountId = String(ga?.accountId || '').trim().toLowerCase();
              if (gaAccountId !== normalizedVendorUsername) return ga;
            }

            return { ...ga, walletCredit: vendorCreditAfter };
          });
          (player as any).metadata = { ...meta, gameAccounts: nextAccounts };
          await (player as any).save({ transaction: tFinal });
        } catch {
        }
      }

      if (reserveBank > 0 && bankAccount) {
        const reservedBankMap = await getPendingReservedWithdrawalByBank(tenancy, tFinal);
        const reservedAll = Number(reservedBankMap[(bankAccount as any).id] ?? 0);
        const reservedOther = reservedAll - reserveBank;
        const total = Number((bankAccount as any).total_balance);
        const next = total + amounts.bankDelta;
        if (next < reservedOther) balanceError('T903', total - reservedAll);
      }
      if (reserveGame > 0) {
        const reservedGameMap = await getPendingReservedDepositByGame(tenancy, tFinal);
        const reservedAll = Number(reservedGameMap[(gameLocked as any).id] ?? 0);
        const reservedOther = reservedAll - reserveGame;
        const total = Number((gameLocked as any).balance);
        const next = total + amounts.gameDelta;
        if (next < reservedOther) balanceError('T904', total - reservedAll);
      }

      let gameBalanceAfter: number | null = null;
      if (gameLocked) {
        const beforeGameBalance = Number((gameLocked as any).balance);
        (gameLocked as any).balance = beforeGameBalance + amounts.gameDelta;
        await (gameLocked as any).save({ transaction: tFinal });
        gameBalanceAfter = Number((gameLocked as any).balance);
      }

      let bankBalanceAfter: number | null = null;
      if (bankAccount) {
        (bankAccount as any).total_balance = Number((bankAccount as any).total_balance) + amounts.bankDelta;
        await (bankAccount as any).save({ transaction: tFinal });
        bankBalanceAfter = Number((bankAccount as any).total_balance);
      } else if (type === 'WALVE') {
        bankBalanceAfter = 0;
      }

      const now = new Date();
      const statsDate = now.toISOString().slice(0, 10);
      let stats = await PlayerStats.findOne({
        where: withTenancyWhere(tenancy, { player_id, date: statsDate } as any),
        transaction: tFinal,
        lock: tFinal.LOCK.UPDATE,
      } as any);
      if (!stats) {
        stats = await PlayerStats.create(
          withTenancyCreate(tenancy, { player_id, date: statsDate }),
          { transaction: tFinal },
        );
      }

      const currentTotalDeposit = Number((stats as any).total_deposit || 0);
      const currentTotalWithdraw = Number((stats as any).total_withdraw || 0);
      const currentTotalWalve = Number((stats as any).total_walve || 0);
      const currentTotalTips = Number((stats as any).total_tips || 0);
      const currentTotalBonus = Number((stats as any).total_bonus || 0);

      if (isDeposit) {
        (stats as any).deposit_count = Number((stats as any).deposit_count || 0) + 1;
        (stats as any).total_deposit = currentTotalDeposit + amountForType;
        const last = (stats as any).last_deposit_at
          ? new Date((stats as any).last_deposit_at)
          : null;
        if (!last || now > last) {
          (stats as any).last_deposit_at = now;
        }
      }
      if (isWithdrawal) {
        (stats as any).withdraw_count = Number((stats as any).withdraw_count || 0) + 1;
        (stats as any).total_withdraw = currentTotalWithdraw + amountForType;
        const last = (stats as any).last_withdraw_at
          ? new Date((stats as any).last_withdraw_at)
          : null;
        if (!last || now > last) {
          (stats as any).last_withdraw_at = now;
        }
      }

      if (isDeposit && bonusForType) {
        (stats as any).total_bonus = currentTotalBonus + bonusForType;
      }
      if (isWithdrawal && walveForType) {
        (stats as any).total_walve = currentTotalWalve + walveForType;
      }
      if (isWithdrawal && tipsForType) {
        (stats as any).total_tips = currentTotalTips + tipsForType;
      }
      if (isWalve && walveForType) {
        (stats as any).total_walve = currentTotalWalve + walveForType;
      }

      await stats.save({ transaction: tFinal });

      await Transaction.update(
        {
          status: 'COMPLETED',
          bank_balance_after: bankBalanceAfter,
          game_balance_after: gameBalanceAfter,
        },
        { where: { id: pendingTransaction.id }, transaction: tFinal },
      );

      await tFinal.commit();

      await pendingTransaction.reload();

      const actionSuffix =
        type === 'DEPOSIT'
          ? 'DEPOSIT'
          : type === 'WITHDRAWAL'
          ? 'WITHDRAWAL'
          : type === 'WALVE'
          ? 'WALVE'
          : 'UNKNOWN';
      await logAudit(
        operator_id,
        `TRANSACTION_CREATE_${actionSuffix}`,
        null,
        pendingTransaction.toJSON(),
        clientIp || undefined,
      );

      sendSuccess(res, 'Code300', pendingTransaction, undefined, 201);
    } catch (e) {
      if (!(tFinal as any).finished) await tFinal.rollback();
      throw e;
    }
  } catch (error: any) {
    const rawOuterMsg = String(error?.message ?? '');
    const lower = rawOuterMsg.toLowerCase();
    if (rawOuterMsg.startsWith('BALANCE_ERR:')) {
      const parts = rawOuterMsg.split(':');
      const code = (parts[1] || 'T900') as string;
      const detail = parts.slice(2).join(':') || 'Invalid balance';
      if (pendingTransaction) {
        try {
          const existingRemark =
            typeof pendingTransaction.remark === 'string' && pendingTransaction.remark.trim().length > 0
              ? pendingTransaction.remark.trim()
              : null;
          const rejectedRemark = `${existingRemark ? `${existingRemark}\n` : ''}${detail}`;
          await Transaction.update(
            { status: 'REJECTED', remark: rejectedRemark },
            { where: { id: pendingTransaction.id } },
          );
          await pendingTransaction.reload();
        } catch {
        }
      }
      if (code === 'T903') {
        sendError(res, 'Code309', 400, { detail });
        return;
      } else if (code === 'T904') {
        sendError(res, 'Code310', 400, { detail });
        return;
      }
      sendError(res, 'Code308', 400, { detail });
      return;
    }

    let responseDetail: string | null = null;
    if (pendingTransaction) {
      try {
        const rawMsg = String(error?.vendorMessage ?? error?.error ?? error?.message ?? error ?? '');
        const vendorMessage = rawMsg.trim().length > 0 ? rawMsg.slice(0, 500) : null;
        const msgLower = rawMsg.toLowerCase();
        let categoryRemark = 'API ERROR';
        if (msgLower.includes('suspended')) categoryRemark = 'Player account is suspended';
        else if (msgLower.includes('insufficient')) categoryRemark = 'Insufficient Credit';
        else if (msgLower.includes('not found')) categoryRemark = 'Player Not Found';
        else if (msgLower.includes('timeout') || msgLower.includes('network') || msgLower.includes('ecconnrefused')) categoryRemark = 'Network Error';
        responseDetail = categoryRemark;

        const existingRemark =
          typeof pendingTransaction.remark === 'string' && pendingTransaction.remark.trim().length > 0
            ? pendingTransaction.remark.trim()
            : null;
        const rejectedRemark = `${existingRemark ? `${existingRemark}\n` : ''}${categoryRemark}`;

        if (msgLower.includes('suspended')) {
          try {
            const fallbackTenancy = getTenancyScopeOrThrow(req);
            const [playerForSync, gameForSync] = await Promise.all([
              ctxPlayerId ? Player.findOne({ where: withTenancyWhere(fallbackTenancy, { id: ctxPlayerId } as any) } as any) : Promise.resolve(null),
              ctxGameId ? Game.findOne({ where: withTenancyWhere(fallbackTenancy, { id: ctxGameId } as any) } as any) : Promise.resolve(null),
            ]);
            const meta = (playerForSync as any)?.metadata;
            const gameName = (gameForSync as any)?.name;
            if (playerForSync && meta && typeof meta === 'object' && Array.isArray((meta as any).gameAccounts) && gameName) {
              const nextAccounts = (meta as any).gameAccounts.map((ga: any) => {
                if (ctxGameAccountId && String(ga?.accountId || '') === String(ctxGameAccountId) && String(ga?.gameName || '') === String(gameName)) {
                  return { ...ga, isEnabled: false, vendorStatusMessage: 'Player account is suspended' };
                }
                return ga;
              });
              (playerForSync as any).metadata = { ...(meta as any), gameAccounts: nextAccounts };
              await (playerForSync as any).save();
            }
          } catch {
          }
        }

        await Transaction.update(
          { status: 'REJECTED', remark: rejectedRemark, vendor_message: vendorMessage },
          { where: { id: pendingTransaction.id } },
        );
        await pendingTransaction.reload();
      } catch {
      }
    }
    sendError(res, 'Code2', 500, { detail: responseDetail });
  }
};

export const updateTransaction = async (req: AuthRequest, res: Response) => {
  const t = await sequelize.transaction();
  try {
    const clientIp = getClientIp(req);
    const tenancy = getTenancyScopeOrThrow(req);
    const id = String(req.params.id);
    const userPermissions = req.user?.permissions || [];

    if (!userPermissions.includes('action:transaction_edit')) {
      await t.rollback();
      sendError(res, 'Code314', 403); // Access denied: Cannot edit transactions
      return;
    }

    const transaction = await Transaction.findOne({ where: withTenancyWhere(tenancy, { id } as any), transaction: t } as any);
    if (!transaction) {
      await t.rollback();
      sendError(res, 'Code315', 404); // Transaction not found
      return;
    }

    const original = transaction.toJSON();

    const remarkRaw = (req.body.remark ?? req.body.staff_note ?? null) as string | null;
    const remark =
      typeof remarkRaw === 'string'
        ? remarkRaw
        : null;

    (transaction as any).remark = remark;

    await transaction.save({ transaction: t });
    await t.commit();

    const typeSuffix =
      (original as any)?.type === 'DEPOSIT'
        ? 'DEPOSIT'
        : (original as any)?.type === 'WITHDRAWAL'
        ? 'WITHDRAWAL'
        : (original as any)?.type === 'WALVE'
        ? 'WALVE'
        : 'UNKNOWN';

    await logAudit(
      req.user?.id,
      `TRANSACTION_EDIT_${typeSuffix}`,
      original,
      transaction.toJSON(),
      clientIp || undefined
    );

    sendSuccess(res, 'Code1', transaction);
  } catch (error: any) {
    if (!(t as any).finished) {
      await t.rollback();
    }
    sendError(res, 'Code316', 500); // Failed to edit transaction
  }
};

export const voidTransaction = async (req: AuthRequest, res: Response) => {
    const t = await sequelize.transaction();
    try {
				const clientIp = getClientIp(req);
        const tenancy = getTenancyScopeOrThrow(req);
        const { id } = req.params;
        const transaction = await Transaction.findOne({
          where: withTenancyWhere(tenancy, { id: Number(id) } as any),
          transaction: t,
          lock: t.LOCK.UPDATE,
        } as any);
        
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        if (transaction.status === 'VOIDED' || transaction.status === 'REJECTED') {
             throw new Error('Transaction is already voided or rejected');
        }
        const bankAccountId = transaction.bank_account_id as number | null;
        const bankAccount = transaction.type === 'WALVE' || bankAccountId == null
          ? null
          : await BankAccount.findOne({
              where: withTenancyWhere(tenancy, { id: bankAccountId } as any),
              transaction: t,
              lock: t.LOCK.UPDATE,
            } as any);
        if (transaction.type !== 'WALVE' && !bankAccount) throw new Error('Bank Account not found');

        const player = transaction.player_id
          ? await Player.findOne({ where: withTenancyWhere(tenancy, { id: transaction.player_id } as any), transaction: t } as any)
          : null;

        let game: any | null = null;
        const effectiveGameId = (transaction as any).game_id || null;
        if (effectiveGameId) {
          game = await Game.findOne({
            where: withTenancyWhere(tenancy, { id: effectiveGameId } as any),
            transaction: t,
            lock: t.LOCK.UPDATE,
          } as any);
        }

        const amount = Number(transaction.amount);
        const bonus = Number((transaction as any).bonus || 0);
        const walve = Number((transaction as any).walve || 0);
        const tips = Number((transaction as any).tips || 0);

        const reservedBankMap = await getPendingReservedWithdrawalByBank(tenancy, t);
        const reservedGameMap = await getPendingReservedDepositByGame(tenancy, t);
        const fmt = (n: number) => `$${Number(n).toFixed(2)}`;
        const insufficientFundsDetail = (available: number) => `Insufficient Funds ${fmt(available)}`;
        const balanceError = (code: 'T903' | 'T904', available: number) => {
          throw new Error(`BALANCE_ERR:${code}:${insufficientFundsDetail(available)}`);
        };

        // Reverse logic
        if (transaction.type === 'DEPOSIT') {
            // New rule:
            //   Bank:   balance += amount
            //   Game:   balance -= (amount + fee)
            // Revert:
            //   Bank:   balance -= amount
            //   Game:   balance += (amount + fee)

            if (bankAccount) {
              const reservedBank = Number(reservedBankMap[(bankAccount as any).id] ?? 0);
              const currentTotal = Number((bankAccount as any).total_balance);
              const nextTotal = currentTotal - amount;
              if (nextTotal < reservedBank) balanceError('T903', currentTotal - reservedBank);
              (bankAccount as any).total_balance = nextTotal;
            }

            if (game) {
                const beforeGame = Number(game.balance);
                game.balance = beforeGame + (amount + bonus);
                await game.save({ transaction: t });
            }

            if (player) {
              await player.save({ transaction: t });
            }
        } else if (transaction.type === 'WITHDRAWAL') {
             // 当前规则：
             //   Bank:   balance -= amount
             //   Game:   balance += amount + fee + tips
             // 撤销：
             //   Bank:   balance += amount
             //   Game:   balance -= amount + fee + tips

             if (bankAccount) {
               // @ts-ignore
               bankAccount.total_balance = Number(bankAccount.total_balance) + amount;
             }

             if (game) {
                const beforeGame = Number(game.balance);
                game.balance = beforeGame - (amount + walve + tips);
                const reservedGame = Number(reservedGameMap[(game as any).id] ?? 0);
                const next = Number(game.balance);
                if (next < reservedGame) balanceError('T904', beforeGame - reservedGame);
                await game.save({ transaction: t });
             }

             if (player) {
               await player.save({ transaction: t });
             }
        } else if (transaction.type === 'ADJUSTMENT') {
            // Original: balance += amount (signed)
            // Revert: balance -= amount
            if (bankAccount) {
              const reservedBank = Number(reservedBankMap[(bankAccount as any).id] ?? 0);
              const currentTotal = Number((bankAccount as any).total_balance);
              const nextTotal = currentTotal - amount;
              if (nextTotal < reservedBank) balanceError('T903', currentTotal - reservedBank);
              (bankAccount as any).total_balance = nextTotal;
            }
        } else if (transaction.type === 'WALVE') {
            // 规则：WALVE 原交易 Game += walve，Bank 不变
            // 撤销：Game -= walve
            if (game) {
              const beforeGame = Number(game.balance);
              game.balance = beforeGame - walve;
              const reservedGame = Number(reservedGameMap[(game as any).id] ?? 0);
              const next = Number(game.balance);
              if (next < reservedGame) balanceError('T904', beforeGame - reservedGame);
              await game.save({ transaction: t });
            }
        }

        if (player) {
          const statsDateSource =
            (transaction as any).created_at || (transaction as any).createdAt;
          const statsDate =
            statsDateSource instanceof Date
              ? statsDateSource
              : new Date(statsDateSource);
          const statsDateOnly = statsDate.toISOString().slice(0, 10);

          const isDeposit = transaction.type === 'DEPOSIT';
          const isWithdrawal = transaction.type === 'WITHDRAWAL';
          const isWalve = transaction.type === 'WALVE';

          let stats = await PlayerStats.findOne({
            where: withTenancyWhere(tenancy, { player_id: transaction.player_id, date: statsDateOnly } as any),
            transaction: t,
            lock: t.LOCK.UPDATE,
          } as any);

          if (!stats) {
            stats = await PlayerStats.create(
              withTenancyCreate(tenancy, { player_id: transaction.player_id, date: statsDateOnly }),
              { transaction: t },
            );
          }

          const currentTotalDeposit = Number((stats as any).total_deposit || 0);
          const currentTotalWithdraw = Number((stats as any).total_withdraw || 0);
          const currentTotalWalve = Number((stats as any).total_walve || 0);
          const currentTotalTips = Number((stats as any).total_tips || 0);
          const currentTotalBonus = Number((stats as any).total_bonus || 0);

          if (isDeposit) {
            const count = Number((stats as any).deposit_count || 0) - 1;
            (stats as any).deposit_count = count < 0 ? 0 : count;
            (stats as any).total_deposit = currentTotalDeposit - amount;
          }

          if (isWithdrawal) {
            const count = Number((stats as any).withdraw_count || 0) - 1;
            (stats as any).withdraw_count = count < 0 ? 0 : count;
            (stats as any).total_withdraw = currentTotalWithdraw - amount;
          }

          const walvePart = isWithdrawal || isWalve ? walve : 0;
          const tipsPart = isWithdrawal ? tips : 0;
          const bonusPart = isDeposit ? bonus : 0;

          if (walvePart) {
            (stats as any).total_walve = currentTotalWalve - walvePart;
          }
          if (tipsPart) {
            (stats as any).total_tips = currentTotalTips - tipsPart;
          }
          if (bonusPart) {
            (stats as any).total_bonus = currentTotalBonus - bonusPart;
          }

          await stats.save({ transaction: t });
        }
        
        if (bankAccount) {
          await bankAccount.save({ transaction: t });
        }

        transaction.status = 'VOIDED';
        await transaction.save({ transaction: t });

				await t.commit();
        
        const typeSuffix =
          (transaction as any)?.type === 'DEPOSIT'
            ? 'DEPOSIT'
            : (transaction as any)?.type === 'WITHDRAWAL'
            ? 'WITHDRAWAL'
            : (transaction as any)?.type === 'WALVE'
            ? 'WALVE'
            : 'UNKNOWN';
				await logAudit(
          req.user?.id,
          `TRANSACTION_VOID_${typeSuffix}`,
          { id },
          transaction.toJSON(),
          clientIp || undefined
        );
        
        sendSuccess(res, 'Code317'); // Transaction voided successfully
    } catch (error: any) {
        if (!(t as any).finished) await t.rollback();
        const msg = String(error?.message ?? '');
        if (msg.startsWith('BALANCE_ERR:')) {
          const parts = msg.split(':');
          const code = (parts[1] || 'T900') as string;
          const detail = parts.slice(2).join(':') || 'Invalid balance';
          if (code === 'T903') {
            sendError(res, 'Code309', 400, { detail });
            return;
          }
          if (code === 'T904') {
            sendError(res, 'Code310', 400, { detail });
            return;
          }
          sendError(res, 'Code308', 400, { detail });
          return;
        }
        sendError(res, 'Code2', 500);
    }
};

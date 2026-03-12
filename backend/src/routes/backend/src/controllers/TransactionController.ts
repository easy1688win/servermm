import { Request, Response } from 'express';
import { Transaction, BankAccount, Player, User, Game, PlayerStats, GameAdjustment, BankCatalog } from '../models';
import { AuthRequest } from '../middleware/auth';
import sequelize from '../config/database';
import { logAudit } from '../services/AuditService';
import { Op } from 'sequelize';
import { sanitizePlayerForResponse } from './PlayerController';
import { sanitizeBankAccountForResponse } from './BankAccountController';
import { decrypt, isEncrypted } from '../utils/encryption';

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
    
    // 确保walve字段被包含
    json.walve = json.walve ?? 0;

    return json;
  });
};

export const getTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const userPermissions = req.user?.permissions || [];
    const scope = (req.query.scope as string | undefined) || null;

    const where: any = {};
    if (scope === 'history') {
      where.type = { [Op.ne]: 'ADJUSTMENT' };
    }

    const transactions = await Transaction.findAll({
      where,
      include: [
        { 
          model: Player,
          include: [{ model: Game }]
        },
        { model: Game },
        { model: BankAccount },
        { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] }
      ],
      order: [['created_at', 'DESC']],
      limit: 100
    });

    const shaped = shapeTransactionsForResponse(transactions, userPermissions);

    res.json(shaped);
  } catch (error) {
    res.status(500).json({ message: 'T891' });
  }
};

export const getPlayerTransactionHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userPermissions = req.user?.permissions || [];

    const playerIdRaw = (req.query.player_id as string | undefined) ?? (req.query.playerId as string | undefined);
    if (!playerIdRaw) {
      return res.status(400).json({ message: 'player_id is required' });
    }

    const playerId = parseInt(playerIdRaw, 10);
    if (!Number.isFinite(playerId) || playerId <= 0) {
      return res.status(400).json({ message: 'Invalid player_id' });
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
        player_id: playerId,
        type: { [Op.ne]: 'ADJUSTMENT' },
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

    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: 'T892' });
  }
};

export const getTransactionsContext = async (req: AuthRequest, res: Response) => {
  try {
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
          where: txWhere,
          include: [
            {
              model: Player,
              include: [{ model: Game }],
            },
            { model: Game },
            { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] },
          ],
          order: [['created_at', 'DESC']],
          limit: 1000,
        } as any),
        Game.findAll({
          where: { status: 'active' },
          order: [['name', 'ASC']],
        } as any),
        GameAdjustment.findAll({
          where: {
            createdAt: { [Op.between]: [startDate, endDate] },
          },
          order: [['createdAt', 'DESC']],
        } as any),
      ]);
      
      const allOperators = canViewUsers ? await User.findAll({
        attributes: ['id', 'username', 'full_name'],
        where: { status: 'active' },
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
          const gameAfterRaw = (t as any).game_balance_after;

          let gameAfter: number | null = null;
          let gameBefore: number | null = null;
          let signedForGame = 0;
          let amountForReturn = baseAmount;

          if (type === 'DEPOSIT') {
            const combined = baseAmount + bonusNum;
            signedForGame = -combined;
            amountForReturn = combined;
          } else if (type === 'WITHDRAWAL') {
            const walveWd = Number((t as any).walve ?? 0);
            const tips = Number((t as any).tips ?? 0);
            signedForGame = baseAmount + walveWd + tips;
          } else if (type === 'WALVE' || type === 'BURN') {
            const walveOnly = Number((t as any).walve ?? 0);
            signedForGame = walveOnly;
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
            amount: amountForReturn,
            walve: t.walve ?? null,
            tips: t.tips ?? null,
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

      return res.json({
        generatedAt: new Date().toISOString(),
        games,
        gameIconMap,
        transactions: shapedTransactions,
        gameAdjustments,
        operatorOptions
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
        where,
        include: [
          {
            model: Player,
            include: [{ model: Game }],
          },
          { model: Game },
          { model: BankAccount },
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

      const [bankAccounts, games, bankCatalog] = await Promise.all([
        BankAccount.findAll(),
        Game.findAll({
          order: [['name', 'ASC']],
        }),
        BankCatalog.findAll({
          order: [['name', 'ASC']],
        }),
      ]);

      const shapedBankAccountsFull = (bankAccounts as any[]).map((b) =>
        sanitizeBankAccountForResponse(b, userPermissions),
      );
      const shapedGamesFull = (games as any[]).map((g: any) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        status: g.status,
        balance: Number(g.balance),
      }));

      const gameIconMap: Record<string, string | null> = {};
      for (const g of games as any[]) {
        if (!g || !g.name) continue;
        gameIconMap[g.name] = g.icon || null;
      }

      const bankIconMap: Record<string, string | null> = {};
      for (const bc of bankCatalog as any[]) {
        if (!bc || !bc.name) continue;
        bankIconMap[bc.name] = bc.icon || null;
      }

      const payloadTransactions = (shapedTransactions as any[]).map((t) => ({
        id: t.id,
        createdAt: t.createdAt ?? t.created_at ?? null,
        type: t.type,
        amount: t.amount ?? null,
        bonus: t.bonus ?? null,
        walve: t.walve ?? null,
        tips: t.tips ?? null,
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

      const allOperators = canViewUsers ? await User.findAll({
        attributes: ['id', 'username', 'full_name'],
        where: { status: 'active' },
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

      return res.json({
        transactions: payloadTransactions,
        games: shapedGamesFull,
        gameIconMap,
        bankAccounts: shapedBankAccountsFull,
        bankIconMap,
        pagination: {
          page,
          pageSize,
          totalItems: total,
          totalPages,
        },
        operatorOptions,
      });
    }

    const where: any = {};

    const [transactions, bankAccounts, games] = await Promise.all([
      Transaction.findAll({
        where,
      include: [
        {
          model: Player,
          include: [{ model: Game }],
        },
        { model: Game },
        { model: BankAccount },
        { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] },
      ],
        order: [['created_at', 'DESC']],
        limit: 5,
      }),
      BankAccount.findAll(),
      Game.findAll({
        where: { status: 'active' },
        order: [['name', 'ASC']]
      })
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
    const shapedGamesFull = (games as any[]).map((g: any) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      status: g.status,
      balance: Number(g.balance),
    }));

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
        : shapedBankAccountsFull;

    const payloadGames =
      scope === 'history'
        ? (shapedGamesFull as any[]).map((g) => ({
            id: g.id,
            name: g.name,
          }))
        : shapedGamesFull;

    res.json({
      transactions: payloadTransactions,
      bankAccounts: payloadBankAccounts,
      games: payloadGames,
    });
  } catch (error) {
    res.status(500).json({ message: 'T893' });
  }
};

export const createTransaction = async (req: AuthRequest, res: Response) => {
  const t = await sequelize.transaction();
  try {
		const clientIp = getClientIp(req);
    const { player_id, bank_account_id, type, amount, game_id, game_account_id } = req.body;
    const bonusRaw = (req.body.bonus ?? 0) as number | string;
    const tipsRaw = (req.body.tips ?? 0) as number | string;
    const remark: string | null = (req.body.remark ?? req.body.staff_note ?? null) as string | null;
    const operator_id = req.user.id;
    const userPermissions = req.user.permissions || [];

    // Permission Check
    if (type === 'DEPOSIT' && !userPermissions.includes('action:deposit_create')) {
        await t.rollback();
        return res.status(403).json({ message: 'Access denied: Cannot create deposits' });
    }
    if (type === 'WITHDRAWAL' && !userPermissions.includes('action:withdrawal_create')) {
        await t.rollback();
        return res.status(403).json({ message: 'Access denied: Cannot create withdrawals' });
    }
    if (type === 'WALVE' && !userPermissions.includes('action:burn_create')) {
        await t.rollback();
        return res.status(403).json({ message: 'Access denied: Cannot create walve transactions' });
    }

    const transactionAmount = parseFloat(amount ?? 0);
    const transactionWalve = parseFloat((bonusRaw as any) || 0);
    const transactionTips = parseFloat((tipsRaw as any) || 0);

    // 1. Load related records
    const bankAccount = type === 'WALVE'
      ? null
      : await BankAccount.findByPk(bank_account_id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        } as any);
    if (type !== 'WALVE' && !bankAccount) {
      throw new Error('Bank account not found');
    }
    const player = await Player.findByPk(player_id, { transaction: t });
    if (!player) {
      throw new Error('Player not found');
    }

    let game: any | null = null;
    const effectiveGameId = game_id || null;
    if (effectiveGameId) {
      game = await Game.findByPk(effectiveGameId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      } as any);
    }

    // Check sufficiency for withdrawal (bank only承担 Amount)
    if (type === 'WITHDRAWAL' && bankAccount) {
        const requiredAmount = transactionAmount;
        const currentBalance = Number(bankAccount.total_balance);
        if (currentBalance < requiredAmount) {
            throw new Error(`Insufficient funds in bank account. Available: ${currentBalance}, Required: ${requiredAmount}`);
        }
    }

    // 2. Update Game Balance (if linked)
    let gameBalanceAfter: number | null = null;
    if (game) {
      const beforeGameBalance = Number(game.balance);

      if (type === 'DEPOSIT') {
        const requiredFromGame = transactionAmount + transactionWalve;
        if (beforeGameBalance < requiredFromGame) {
          throw new Error('T894');
        }
        game.balance = beforeGameBalance - requiredFromGame;
      } else if (type === 'WITHDRAWAL') {
        // WITHDRAWAL: Game 承担 Amount + Walve + Tips
        game.balance = beforeGameBalance + transactionAmount + transactionWalve + transactionTips;
      } else if (type === 'WALVE') {
        // WALVE: 只有 Walve 影响游戏
        game.balance = beforeGameBalance + transactionWalve;
      }

      await game.save({ transaction: t });
      gameBalanceAfter = Number(game.balance);
    }

    // 3. Update Bank Account Balance（Walve/Tips 不影响银行）
    let bankBalanceAfter: number | null = null;
    if (bankAccount) {
      if (type === 'DEPOSIT') {
        // Deposit: Amount 进银行，Bonus 不影响银行
        // @ts-ignore
        bankAccount.total_balance = Number(bankAccount.total_balance) + transactionAmount;
      } else if (type === 'WITHDRAWAL') {
        // Withdrawal: 只有 Amount 从银行出
        // @ts-ignore
        bankAccount.total_balance = Number(bankAccount.total_balance) - transactionAmount;
      } else if (type === 'ADJUSTMENT') {
        // 保持原有逻辑，由其它入口控制
      }
      await bankAccount.save({ transaction: t });
      // @ts-ignore
      bankBalanceAfter = Number(bankAccount.total_balance);
    } else if (type === 'WALVE') {
      // WALVE 交易与银行无关，为兼容旧表 NOT NULL 约束，写 0
      bankBalanceAfter = 0;
    }

    // 4. Update PlayerStats
    const now = new Date();
    const statsDate = now.toISOString().slice(0, 10);
    const isDeposit = type === 'DEPOSIT';
    const isWithdrawal = type === 'WITHDRAWAL';
    const isWalve = type === 'WALVE';

    let stats = await PlayerStats.findOne({
      where: { player_id, date: statsDate },
      transaction: t,
      lock: t.LOCK.UPDATE,
    } as any);

    if (!stats) {
      stats = await PlayerStats.create(
        {
          player_id,
          date: statsDate,
        },
        { transaction: t },
      );
    }

    const currentTotalDeposit = Number((stats as any).total_deposit || 0);
    const currentTotalWithdraw = Number((stats as any).total_withdraw || 0);
    const currentTotalWalve = Number((stats as any).total_walve || 0);
    const currentTotalTips = Number((stats as any).total_tips || 0);
    const currentTotalBonus = Number((stats as any).total_bonus || 0);

    if (isDeposit) {
      (stats as any).deposit_count = Number((stats as any).deposit_count || 0) + 1;
      (stats as any).total_deposit = currentTotalDeposit + transactionAmount;
      const last = (stats as any).last_deposit_at
        ? new Date((stats as any).last_deposit_at)
        : null;
      if (!last || now > last) {
        (stats as any).last_deposit_at = now;
      }
    }

    if (isWithdrawal) {
      (stats as any).withdraw_count = Number((stats as any).withdraw_count || 0) + 1;
      (stats as any).total_withdraw = currentTotalWithdraw + transactionAmount;
      const last = (stats as any).last_withdraw_at
        ? new Date((stats as any).last_withdraw_at)
        : null;
      if (!last || now > last) {
        (stats as any).last_withdraw_at = now;
      }
    }

    const walvePart =
      isWithdrawal || isWalve ? transactionWalve : 0;
    const tipsPart = isWithdrawal ? transactionTips : 0;
    const bonusPart = isDeposit ? transactionWalve : 0;

    if (walvePart) {
      (stats as any).total_walve = currentTotalWalve + walvePart;
    }
    if (tipsPart) {
      (stats as any).total_tips = currentTotalTips + tipsPart;
    }
    if (bonusPart) {
      (stats as any).total_bonus = currentTotalBonus + bonusPart;
    }

    await stats.save({ transaction: t });

    // 6. Create Transaction
		const transaction = await Transaction.create({
      player_id,
      bank_account_id: type === 'WALVE' ? null : bank_account_id,
      game_id: effectiveGameId,
      game_account_id,
      operator_id,
      type,
      amount: type === 'WALVE' ? 0 : amount,
      bonus: isDeposit ? transactionWalve : 0,
      tips: transactionTips,
      walve: isWithdrawal || type === 'WALVE' ? transactionWalve : 0,
      remark,
      ip_address: clientIp,
      status: 'COMPLETED',
      bank_balance_after: bankBalanceAfter,
      game_balance_after: gameBalanceAfter,
    }, { transaction: t });

		await t.commit();
		
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
      transaction.toJSON(),
      clientIp || undefined
    );

    res.status(201).json(transaction);
  } catch (error: any) {
    if (!(t as any).finished) {
        await t.rollback();
    }
    console.error('Transaction Error:', error);
    res.status(500).json({ message: 'T894' });
  }
};

export const updateTransaction = async (req: AuthRequest, res: Response) => {
  const t = await sequelize.transaction();
  try {
    const clientIp = getClientIp(req);
    const id = String(req.params.id);
    const userPermissions = req.user?.permissions || [];

    if (!userPermissions.includes('action:transaction_edit')) {
      await t.rollback();
      return res.status(403).json({ message: 'Access denied: Cannot edit transactions' });
    }

    const transaction = await Transaction.findByPk(id, { transaction: t } as any);
    if (!transaction) {
      await t.rollback();
      return res.status(404).json({ message: 'Transaction not found' });
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

    return res.json(transaction);
  } catch (error: any) {
    if (!(t as any).finished) {
      await t.rollback();
    }
    console.error('Transaction Edit Error:', error);
    return res.status(500).json({ message: 'T895' });
  }
};

export const voidTransaction = async (req: AuthRequest, res: Response) => {
    const t = await sequelize.transaction();
    try {
				const clientIp = getClientIp(req);
        const { id } = req.params;
        const transaction = await Transaction.findByPk(Number(id), { transaction: t });
        
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        if (transaction.status === 'VOIDED' || transaction.status === 'REJECTED') {
             throw new Error('Transaction is already voided or rejected');
        }
        const bankAccountId = transaction.bank_account_id as number | null;
        const bankAccount = transaction.type === 'WALVE' || bankAccountId == null
          ? null
          : await BankAccount.findByPk(bankAccountId, { transaction: t });
        if (transaction.type !== 'WALVE' && !bankAccount) throw new Error('Bank Account not found');

        const player = transaction.player_id
          ? await Player.findByPk(transaction.player_id, { transaction: t })
          : null;

        let game: any | null = null;
        const effectiveGameId = (transaction as any).game_id || null;
        if (effectiveGameId) {
          game = await Game.findByPk(effectiveGameId, { transaction: t });
        }

        const amount = Number(transaction.amount);
        const fee = Number((transaction as any).walve || (transaction as any).bonus || 0);
        const tips = Number((transaction as any).tips || 0);

        // Reverse logic
        if (transaction.type === 'DEPOSIT') {
            // New rule:
            //   Bank:   balance += amount
            //   Game:   balance -= (amount + fee)
            // Revert:
            //   Bank:   balance -= amount
            //   Game:   balance += (amount + fee)

            // @ts-ignore
            bankAccount.total_balance = Number(bankAccount.total_balance) - amount;

            if (game) {
                const beforeGame = Number(game.balance);
                game.balance = beforeGame + (amount + fee);
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
                game.balance = beforeGame - (amount + fee + tips);
                await game.save({ transaction: t });
             }

             if (player) {
               await player.save({ transaction: t });
             }
        } else if (transaction.type === 'ADJUSTMENT') {
            // Original: balance += amount (signed)
            // Revert: balance -= amount
            // @ts-ignore
            if (bankAccount) {
              // @ts-ignore
              bankAccount.total_balance = Number(bankAccount.total_balance) - amount;
            }
        } else if (transaction.type === 'WALVE') {
            // 原规则：Game += fee（walve），Bank 不变
            // 撤销：Game -= fee
            if (game) {
              const beforeGame = Number(game.balance);
              game.balance = beforeGame - fee;
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
            where: { player_id: transaction.player_id, date: statsDateOnly },
            transaction: t,
            lock: t.LOCK.UPDATE,
          } as any);

          if (!stats) {
            stats = await PlayerStats.create(
              {
                player_id: transaction.player_id,
                date: statsDateOnly,
              },
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

          const walvePart =
            isWithdrawal || isWalve ? fee : 0;
          const tipsPart = isWithdrawal ? tips : 0;
          const bonusPart = fee;

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
        
        res.json({ message: 'Transaction voided successfully' });
    } catch (error: any) {
        if (!(t as any).finished) await t.rollback();
        console.error('Void Transaction Error:', error);
        res.status(500).json({ message: 'T896' });
    }
};

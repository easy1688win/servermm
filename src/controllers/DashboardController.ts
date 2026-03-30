import { Response } from 'express';
import { Op } from 'sequelize';
import { AuthRequest } from '../middleware/auth';
import { BankAccount, Player, Transaction, User, Game, BankCatalog } from '../models';
import { getCache, setCache } from '../services/CacheService';
import { decrypt, isEncrypted } from '../utils/encryption';
import { sendSuccess, sendError } from '../utils/response';
import { getTenancyScopeOrThrow, withTenancyWhere } from '../tenancy/scope';

export const getDashboardSummary = async (req: AuthRequest, res: Response) => {
  try {
    const tenancy = getTenancyScopeOrThrow(req);
    const userId = req.user?.id || 0;
    const permissions = req.user?.permissions || [];
    const cacheKey = `dashboard:summary:${userId}:${tenancy.tenant_id}:${tenancy.sub_brand_id}`;

    const cached = getCache(cacheKey);
    if (cached) {
      return sendSuccess(res, 'Code1', cached);
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const canViewBalance = permissions.includes('view:bank_balance');
    const canViewFullAccount = permissions.includes('view:bank_full_account');
    const canViewProfit = permissions.includes('view:player_profit');
    const canViewFinancials = permissions.includes('view:dashboard_financials');

    const [banksResult, playersResult, transactionsResult, gamesResult, bankCatalogResult] = await Promise.allSettled([
      BankAccount.findAll({ where: withTenancyWhere(tenancy) } as any),
      Player.findAll({
        attributes: ['id', 'player_game_id', 'createdAt'],
        where: withTenancyWhere(tenancy, { createdAt: { [Op.between]: [startOfDay, endOfDay] } }),
      } as any),
      Transaction.findAll({
        where: withTenancyWhere(tenancy, { created_at: { [Op.between]: [startOfDay, endOfDay] } }),
        include: [
          { model: BankAccount, required: false, where: withTenancyWhere(tenancy) as any },
          { model: Player, required: false, where: withTenancyWhere(tenancy) as any },
          { model: Game, required: false, where: withTenancyWhere(tenancy) as any },
          { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] },
        ],
        order: [['created_at', 'DESC']],
        limit: 500,
      } as any),
      Game.findAll({
        where: withTenancyWhere(tenancy, { status: 'active' }),
      } as any),
      BankCatalog.findAll({
        order: [['name', 'ASC']]
      }),
    ]);

    const banksRaw = banksResult.status === 'fulfilled' ? banksResult.value : [];
    const playersRaw = playersResult.status === 'fulfilled' ? playersResult.value : [];
    const transactionsRaw = transactionsResult.status === 'fulfilled' ? transactionsResult.value : [];
    const gamesRaw = gamesResult.status === 'fulfilled' ? gamesResult.value : [];
    const bankCatalogRaw = bankCatalogResult.status === 'fulfilled' ? bankCatalogResult.value : [];

    // Create bank catalog map for icon lookup (case-insensitive and trimmed)
    const bankCatalogMap = new Map<string, string | null>();
    (bankCatalogRaw as any[]).forEach((catalog: any) => {
      const normalizedName = catalog.name ? catalog.name.toString().trim().toLowerCase() : '';
      if (normalizedName) {
        bankCatalogMap.set(normalizedName, catalog.icon);
      }
    });

    const banks = (banksRaw as any[])
      .filter(account => account.status !== 'banned')
      .map(account => {
        const acc = account.toJSON();

        if (!canViewBalance) {
          acc.total_balance = null;
        } else if (acc.total_balance !== null && acc.total_balance !== undefined) {
          acc.total_balance = Number(acc.total_balance);
        }

        const rawNumber: string | null = acc.account_number || null;
        let displayNumber: string | null = null;

        if (rawNumber) {
          const digitsOnly = String(rawNumber).replace(/\D/g, '');
          if (canViewFullAccount) {
            displayNumber = digitsOnly;
          } else if (digitsOnly.length >= 4) {
            const last4 = digitsOnly.slice(-4);
            displayNumber = `•••• ${last4}`;
          } else {
            displayNumber = '•••• ****';
          }
        }

        acc.account_number_display = displayNumber;

        if (!canViewFullAccount) {
          acc.account_number = null;
        }

        return acc;
      });

    const players = (playersRaw as any[]).map(player => {
      const p = player.toJSON();
      const createdAt = p.createdAt || p.created_at;
      return {
        id: p.id,
        player_game_id: p.player_game_id,
        createdAt,
      };
    });

    const transactions = (transactionsRaw as any[]).map(tx => {
      const json = tx.toJSON();

      if (json.created_at && !json.createdAt) {
        json.createdAt = json.created_at;
      }

      const bankAccountId = json.bank_account_id ?? null;
      const playerId = json.player_id ?? null;
      let operatorName: string | null = null;
      if (json.operator) {
        const rawFullName =
          typeof json.operator.full_name === 'string' && json.operator.full_name.trim().length > 0
            ? json.operator.full_name.trim()
            : null;
        const rawUsername =
            typeof json.operator.username === 'string' && json.operator.username.trim().length > 0
              ? json.operator.username.trim()
              : 'Staff';

        if (rawFullName) {
          if (isEncrypted(rawFullName)) {
            const decrypted = decrypt(rawFullName);
            operatorName = decrypted !== rawFullName ? decrypted : rawUsername;
          } else {
            operatorName = rawFullName;
          }
        } else {
          operatorName = rawUsername;
        }
      }
      operatorName = operatorName || 'Staff';
      const gameRel = json.Game || json.Player?.Game || null;
      const gameId = json.game_id ?? gameRel?.id ?? null;
      const gameName = gameRel?.name || null;
      const playerGameId = json.Player?.player_game_id || null;

      const amount = json.amount != null ? Number(json.amount) : 0;
      const bonus = json.bonus != null ? Number(json.bonus) : 0;
      const tips = json.tips != null ? Number(json.tips) : 0;
      const walve = json.walve != null ? Number(json.walve) : 0;

      return {
        id: json.id,
        transactionId: String(json.id),
        date: json.createdAt,
        type: json.type,
        amount,
        bonus,
        tips,
        walve,
        bankAccountId,
        playerId,
        operatorName,
        gameId,
        gameName,
        playerGameId,
        status: json.status,
      };
    });

    const games = (gamesRaw as any[])
      .filter((game: any) => {
        const g = typeof game.toJSON === 'function' ? game.toJSON() : game;
        return g.status === 'active';
      })
      .map((game: any) => {
        const g = typeof game.toJSON === 'function' ? game.toJSON() : game;
        return {
          id: g.id,
          name: g.name,
          icon: g.icon,
          balance:
            typeof g.balance === 'number'
              ? g.balance
              : Number(g.balance ?? 0),
        };
      });

    const stats = {
      activePlayersToday: 0,
      newPlayersToday: players.length,
      newPlayersWithDeposit: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      netCashFlow: 0,
      depositCount: 0,
      withdrawalCount: 0,
      totalCount: 0,
      totalBonus: 0,
    };

    const activePlayerIds = new Set<number>();
    const depositPlayerIds = new Set<number>();

    const bankAgg = new Map<number, { depositsAmount: number; depositsCount: number; withdrawalsAmount: number; withdrawalsCount: number }>();
    const gameAgg = new Map<number, { depositsAmount: number; depositsCount: number; withdrawalsAmount: number; withdrawalsCount: number }>();
    const staffMap = new Map<string, { operatorName: string; initials: string; txCount: number; volume: number }>();

    transactions.forEach(t => {
      const amount = t.amount != null ? Number(t.amount) : 0;
      const bonus = t.bonus != null ? Number(t.bonus) : 0;
      const tips = t.tips != null ? Number(t.tips) : 0;
      const walve = t.walve != null ? Number(t.walve) : 0;
      const isDeposit = t.type === 'DEPOSIT';
      const isWithdrawal = t.type === 'WITHDRAWAL';

      if (t.playerId != null) {
        activePlayerIds.add(t.playerId);
      }
      if (isDeposit && t.playerId != null) {
        depositPlayerIds.add(t.playerId);
      }

      if (isDeposit || isWithdrawal) {
        stats.totalCount += 1;
      }
      if (isDeposit) {
        stats.totalDeposits += amount;
        stats.depositCount += 1;
        stats.totalBonus += bonus;
      } else if (isWithdrawal) {
        stats.totalWithdrawals += amount;
        stats.withdrawalCount += 1;
      } else if (t.type === 'WALVE') {
        stats.totalBonus += walve;
      }

      if (t.bankAccountId != null) {
        const current = bankAgg.get(t.bankAccountId) || {
          depositsAmount: 0,
          depositsCount: 0,
          withdrawalsAmount: 0,
          withdrawalsCount: 0,
        };
        if (isDeposit) {
          current.depositsAmount += amount;
          current.depositsCount += 1;
        } else if (isWithdrawal) {
          current.withdrawalsAmount += amount;
          current.withdrawalsCount += 1;
        }
        bankAgg.set(t.bankAccountId, current);
      }

      if (t.gameId != null) {
        const current = gameAgg.get(t.gameId) || {
          depositsAmount: 0,
          depositsCount: 0,
          withdrawalsAmount: 0,
          withdrawalsCount: 0,
        };
        if (isDeposit) {
          current.depositsAmount += amount + bonus;
          current.depositsCount += 1;
        } else if (isWithdrawal) {
          current.withdrawalsAmount += amount + walve + tips;
          current.withdrawalsCount += 1;
        } else if (t.type === 'WALVE') {
          current.withdrawalsAmount += walve;
          current.withdrawalsCount += 1;
        }
        gameAgg.set(t.gameId, current);
      }

      const operatorName = t.operatorName || 'Staff';
      const existing = staffMap.get(operatorName) || {
        operatorName,
        initials: operatorName.slice(0, 2).toUpperCase(),
        txCount: 0,
        volume: 0,
      };
      existing.txCount += 1;

      let volumeDelta = 0;
      if (isDeposit || isWithdrawal) {
        volumeDelta = amount;
      } else if (t.type === 'WALVE') {
        volumeDelta = walve;
      }

      existing.volume += volumeDelta;
      staffMap.set(operatorName, existing);
    });

    stats.activePlayersToday = activePlayerIds.size;
    stats.newPlayersWithDeposit = players.filter(p => depositPlayerIds.has(p.id)).length;
    stats.netCashFlow = stats.totalDeposits - stats.totalWithdrawals;

    const bankReports = banks.map((bank: any) => {
      const bankId = bank.id;
      const agg = bankAgg.get(bankId) || {
        depositsAmount: 0,
        depositsCount: 0,
        withdrawalsAmount: 0,
        withdrawalsCount: 0,
      };

      const normalizedName = bank.bank_name?.toString().trim().toLowerCase() || '';
      const icon = bankCatalogMap.get(normalizedName) ?? null;

      return {
        bankId,
        bankName: bank.bank_name,
        alias: bank.alias ?? null,
        accountNumberDisplay: bank.account_number_display ?? null,
        icon: icon,
        depositsAmount: canViewFinancials ? agg.depositsAmount : null,
        depositsCount: agg.depositsCount,
        withdrawalsAmount: canViewFinancials ? agg.withdrawalsAmount : null,
        withdrawalsCount: agg.withdrawalsCount,
        balance: bank.total_balance != null ? Number(bank.total_balance) : 0,
      };
    });

    const kioskReports = games.map((g) => {
      const agg =
        gameAgg.get(g.id) || {
          depositsAmount: 0,
          depositsCount: 0,
          withdrawalsAmount: 0,
          withdrawalsCount: 0,
        };
      return {
        gameId: g.id,
        gameName: g.name,
        icon: g.icon,
        depositsAmount: canViewFinancials ? agg.depositsAmount : null,
        depositsCount: agg.depositsCount,
        withdrawalsAmount: canViewFinancials ? agg.withdrawalsAmount : null,
        withdrawalsCount: agg.withdrawalsCount,
        balance: g.balance,
      };
    });

    const staffPerformance = Array.from(staffMap.values()).map(s => ({
      ...s,
      volume: canViewFinancials ? s.volume : null
    }));

    // Mask sensitive financial totals if no permission
    const finalStats = {
      ...stats,
      totalDeposits: canViewFinancials ? stats.totalDeposits : null,
      totalWithdrawals: canViewFinancials ? stats.totalWithdrawals : null,
      netCashFlow: canViewFinancials ? stats.netCashFlow : null,
      totalBonus: canViewFinancials ? stats.totalBonus : null,
    };

    const recentTransactions = transactions
      .slice(0, 5)
      .map(t => {
        const bank = (banks as any[]).find(b => b.id === t.bankAccountId);

        let bonusForRecent = t.bonus;
        if (t.type === 'WALVE') {
          bonusForRecent = t.walve ?? t.bonus;
        }

        return {
          id: t.id,
          type: t.type,
          amount: canViewFinancials ? t.amount : null, // Mask amount in recent transactions too? User didn't specify recent transactions but likely implied. Let's keep consistent.
          bonus: canViewFinancials ? bonusForRecent : null,
          date: t.date,
          playerGameId: t.playerGameId,
          operatorName: t.operatorName,
          bankId: t.bankAccountId,
          bankName: bank?.bank_name ?? null,
          bankAlias: bank?.alias ?? null,
          bankAccountNumberDisplay: bank?.account_number_display ?? null,
        };
      });

    // Build sub brand options for FE
    let subBrandOptions: any[] = [];
    try {
      const requesterId = req.user?.id;
      const requester: any = requesterId
        ? await User.findByPk(requesterId, { include: [] } as any)
        : null;
      const userRoles = (req.user as any)?.Roles || requester?.Roles || [];
      const isSuperAdmin =
        Boolean(req.user?.is_super_admin) ||
        Boolean(userRoles?.some?.((r: any) => String(r?.name ?? '').toLowerCase() === 'super admin'));
      const isOperator = Boolean(userRoles?.some?.((r: any) => String(r?.name ?? '').toLowerCase() === 'operator'));

      const { SubBrand } = await import('../models');
      if (isSuperAdmin) {
        const rows = await SubBrand.findAll({ order: [['id', 'ASC']] } as any);
        subBrandOptions = (rows as any[]).map((sb: any) => ({
          id: sb.id,
          tenant_id: (sb as any).tenant_id ?? null,
          code: (sb as any).code ?? null,
          name: (sb as any).name ?? null,
          status: (sb as any).status ?? null,
        }));
      } else if (isOperator) {
        const tid = Number(req.user?.tenant_id ?? null);
        if (Number.isFinite(tid) && tid > 0) {
          const rows = await SubBrand.findAll({ where: { tenant_id: tid } as any, order: [['id', 'ASC']] } as any);
          subBrandOptions = (rows as any[]).map((sb: any) => ({
            id: sb.id,
            tenant_id: (sb as any).tenant_id ?? null,
            code: (sb as any).code ?? null,
            name: (sb as any).name ?? null,
            status: (sb as any).status ?? null,
          }));
        }
      } else if (Number.isFinite(req.user?.sub_brand_id)) {
        const rows = await SubBrand.findAll({ where: { id: req.user?.sub_brand_id } as any, order: [['id', 'ASC']] } as any);
        subBrandOptions = (rows as any[]).map((sb: any) => ({
          id: sb.id,
          tenant_id: (sb as any).tenant_id ?? null,
          code: (sb as any).code ?? null,
          name: (sb as any).name ?? null,
          status: (sb as any).status ?? null,
        }));
      }
    } catch {
    }

    const summary = {
      generatedAt: now.toISOString(),
      stats: finalStats,
      bankReports,
      kioskReports,
      staffPerformance,
      recentTransactions,
      subBrandOptions,
      partialErrors: {
        banks: banksResult.status === 'rejected',
        players: playersResult.status === 'rejected',
        transactions: transactionsResult.status === 'rejected',
        games: gamesResult.status === 'rejected',
        bankCatalog: bankCatalogResult.status === 'rejected',
      },
    };

    setCache(cacheKey, summary, 30);
    sendSuccess(res, 'Code1', summary);
  } catch (error) {
    sendError(res, 'Code424', 500); // Failed to load dashboard summary
  }
};

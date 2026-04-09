import { Response } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { AuthRequest } from '../middleware/auth';
import { BankAccount, Player, Transaction, User, Game, BankCatalog, Role } from '../models';
import { getCache, setCache } from '../services/CacheService';
import { decrypt, isEncrypted } from '../utils/encryption';
import { sendSuccess, sendError } from '../utils/response';
import { getTenancyScopeOrThrow, withTenancyWhere } from '../tenancy/scope';
import sequelize from '../config/database';

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

    const [banksResult, gamesResult, bankCatalogResult, statsRow, newPlayersRow, newPlayersWithDepRow, bankAggRows, gameAggRows, staffRows] =
      await Promise.all([
        BankAccount.findAll({ where: withTenancyWhere(tenancy) } as any),
        Game.findAll({ where: withTenancyWhere(tenancy, { status: 'active' }) } as any),
        BankCatalog.findAll({ order: [['name', 'ASC']] }),
        sequelize.query(
          `
          SELECT
            SUM(CASE WHEN type='DEPOSIT' AND status='COMPLETED' THEN amount ELSE 0 END) AS totalDeposits,
            SUM(CASE WHEN type='WITHDRAWAL' AND status='COMPLETED' THEN amount ELSE 0 END) AS totalWithdrawals,
            SUM(CASE WHEN type='DEPOSIT' THEN bonus ELSE 0 END) 
              + SUM(CASE WHEN type='WALVE' THEN walve ELSE 0 END) AS totalBonus,
            SUM(CASE WHEN type='DEPOSIT' AND status='COMPLETED' THEN 1 ELSE 0 END) AS depositCount,
            SUM(CASE WHEN type='WITHDRAWAL' AND status='COMPLETED' THEN 1 ELSE 0 END) AS withdrawalCount,
            SUM(CASE WHEN type IN ('DEPOSIT','WITHDRAWAL') THEN 1 ELSE 0 END) AS totalCount,
            COUNT(DISTINCT CASE WHEN player_id IS NOT NULL THEN player_id END) AS activePlayers
          FROM transactions
          WHERE tenant_id=:tenantId AND sub_brand_id=:subBrandId
            AND created_at BETWEEN :startAt AND :endAt
          `,
          {
            replacements: { tenantId: tenancy.tenant_id, subBrandId: tenancy.sub_brand_id, startAt: startOfDay, endAt: endOfDay },
            type: QueryTypes.SELECT,
          },
        ),
        sequelize.query(
          `
          SELECT COUNT(*) AS cnt
          FROM players
          WHERE tenant_id=:tenantId AND sub_brand_id=:subBrandId
            AND createdAt BETWEEN :startAt AND :endAt
          `,
          {
            replacements: { tenantId: tenancy.tenant_id, subBrandId: tenancy.sub_brand_id, startAt: startOfDay, endAt: endOfDay },
            type: QueryTypes.SELECT,
          },
        ),
        sequelize.query(
          `
          SELECT COUNT(DISTINCT p.id) AS cnt
          FROM players p
          JOIN transactions t
            ON t.player_id = p.id
            AND t.tenant_id = p.tenant_id
            AND t.sub_brand_id = p.sub_brand_id
          WHERE p.tenant_id=:tenantId AND p.sub_brand_id=:subBrandId
            AND p.createdAt BETWEEN :startAt AND :endAt
            AND t.type='DEPOSIT' AND t.status='COMPLETED'
            AND t.created_at BETWEEN :startAt AND :endAt
          `,
          {
            replacements: { tenantId: tenancy.tenant_id, subBrandId: tenancy.sub_brand_id, startAt: startOfDay, endAt: endOfDay },
            type: QueryTypes.SELECT,
          },
        ),
        sequelize.query(
          `
          SELECT
            bank_account_id AS bankId,
            SUM(CASE WHEN type='DEPOSIT' AND status='COMPLETED' THEN amount ELSE 0 END) AS depAmt,
            SUM(CASE WHEN type='DEPOSIT' AND status='COMPLETED' THEN 1 ELSE 0 END) AS depCnt,
            SUM(
              CASE 
                WHEN status='COMPLETED' AND type='WITHDRAWAL' THEN amount + walve + tips
                WHEN status='COMPLETED' AND type='WALVE' THEN walve
                ELSE 0
              END
            ) AS wdAmt,
            SUM(CASE WHEN status='COMPLETED' AND type IN ('WITHDRAWAL','WALVE') THEN 1 ELSE 0 END) AS wdCnt
          FROM transactions
          WHERE tenant_id=:tenantId AND sub_brand_id=:subBrandId
            AND created_at BETWEEN :startAt AND :endAt
          GROUP BY bank_account_id
          `,
          {
            replacements: { tenantId: tenancy.tenant_id, subBrandId: tenancy.sub_brand_id, startAt: startOfDay, endAt: endOfDay },
            type: QueryTypes.SELECT,
          },
        ),
        sequelize.query(
          `
          SELECT
            game_id AS gameId,
            SUM(
              CASE 
                WHEN status='COMPLETED' AND type='DEPOSIT' THEN amount + bonus 
                ELSE 0
              END
            ) AS depAmt,
            SUM(CASE WHEN status='COMPLETED' AND type='DEPOSIT' THEN 1 ELSE 0 END) AS depCnt,
            SUM(
              CASE 
                WHEN status='COMPLETED' AND type='WITHDRAWAL' THEN amount + walve + tips
                WHEN status='COMPLETED' AND type='WALVE' THEN walve
                ELSE 0
              END
            ) AS wdAmt,
            SUM(CASE WHEN status='COMPLETED' AND type IN ('WITHDRAWAL','WALVE') THEN 1 ELSE 0 END) AS wdCnt
          FROM transactions
          WHERE tenant_id=:tenantId AND sub_brand_id=:subBrandId
            AND created_at BETWEEN :startAt AND :endAt
          GROUP BY game_id
          `,
          {
            replacements: { tenantId: tenancy.tenant_id, subBrandId: tenancy.sub_brand_id, startAt: startOfDay, endAt: endOfDay },
            type: QueryTypes.SELECT,
          },
        ),
        sequelize.query(
          `
          SELECT 
            t.operator_id AS operatorId,
            u.full_name AS fullName,
            u.username AS username,
            COUNT(*) AS txCount,
            SUM(
              CASE 
                WHEN t.status='COMPLETED' AND t.type='DEPOSIT' THEN t.amount + t.bonus
                WHEN t.status='COMPLETED' AND t.type='WITHDRAWAL' THEN t.amount + t.walve + t.tips
                WHEN t.status='COMPLETED' AND t.type='WALVE' THEN t.walve
                ELSE 0
              END
            ) AS volume
          FROM transactions t
          LEFT JOIN users u ON u.id = t.operator_id
          WHERE t.tenant_id=:tenantId AND t.sub_brand_id=:subBrandId
            AND t.created_at BETWEEN :startAt AND :endAt
          GROUP BY t.operator_id, u.full_name, u.username
          `,
          {
            replacements: { tenantId: tenancy.tenant_id, subBrandId: tenancy.sub_brand_id, startAt: startOfDay, endAt: endOfDay },
            type: QueryTypes.SELECT,
          },
        ),
      ]);

    const banksRaw = banksResult as any[];
    const gamesRaw = gamesResult as any[];
    const bankCatalogRaw = bankCatalogResult as any[];

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

    const statsBase = Array.isArray(statsRow) && statsRow[0] ? statsRow[0] as any : {};
    const newPlayersToday = Array.isArray(newPlayersRow) && newPlayersRow[0] ? Number((newPlayersRow[0] as any).cnt || 0) : 0;
    const newPlayersWithDeposit = Array.isArray(newPlayersWithDepRow) && newPlayersWithDepRow[0] ? Number((newPlayersWithDepRow[0] as any).cnt || 0) : 0;

    const bankAggMap = new Map<number, { depositsAmount: number; depositsCount: number; withdrawalsAmount: number; withdrawalsCount: number }>();
    for (const r of (bankAggRows as any[])) {
      const bankId = Number(r.bankId ?? 0);
      if (!Number.isFinite(bankId) || bankId <= 0) continue;
      bankAggMap.set(bankId, {
        depositsAmount: Number(r.depAmt || 0),
        depositsCount: Number(r.depCnt || 0),
        withdrawalsAmount: Number(r.wdAmt || 0),
        withdrawalsCount: Number(r.wdCnt || 0),
      });
    }

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

    const gameAggMap = new Map<number, { depositsAmount: number; depositsCount: number; withdrawalsAmount: number; withdrawalsCount: number }>();
    for (const r of (gameAggRows as any[])) {
      const gameId = Number(r.gameId ?? 0);
      if (!Number.isFinite(gameId) || gameId <= 0) continue;
      gameAggMap.set(gameId, {
        depositsAmount: Number(r.depAmt || 0),
        depositsCount: Number(r.depCnt || 0),
        withdrawalsAmount: Number(r.wdAmt || 0),
        withdrawalsCount: Number(r.wdCnt || 0),
      });
    }

    const staffMap = new Map<string, { operatorName: string; initials: string; txCount: number; volume: number }>();
    for (const r of (staffRows as any[])) {
      const operatorId = Number((r as any).operatorId ?? null);
      const rawFullName = typeof (r as any).fullName === 'string' ? String((r as any).fullName).trim() : '';
      const rawUsername = typeof (r as any).username === 'string' ? String((r as any).username).trim() : '';

      let operatorName: string | null = rawFullName || null;
      if (operatorName) {
        if (isEncrypted(operatorName)) {
          const dec = decrypt(operatorName);
          operatorName = dec !== operatorName ? dec : (rawUsername || null);
        }
      } else if (rawUsername) {
        operatorName = isEncrypted(rawUsername) ? decrypt(rawUsername) : rawUsername;
      }
      operatorName = operatorName || 'Staff';

      const key = Number.isFinite(operatorId) && operatorId > 0 ? String(operatorId) : operatorName;
      staffMap.set(key, {
        operatorName,
        initials: operatorName.slice(0, 2).toUpperCase(),
        txCount: Number((r as any).txCount || 0),
        volume: Number((r as any).volume || 0),
      });
    }

    const stats = {
      activePlayersToday: Number(statsBase.activePlayers || 0),
      newPlayersToday,
      newPlayersWithDeposit,
      totalDeposits: Number(statsBase.totalDeposits || 0),
      totalWithdrawals: Number(statsBase.totalWithdrawals || 0),
      netCashFlow: Number(statsBase.totalDeposits || 0) - Number(statsBase.totalWithdrawals || 0) - Number(statsBase.totalBonus || 0),
      depositCount: Number(statsBase.depositCount || 0),
      withdrawalCount: Number(statsBase.withdrawalCount || 0),
      totalCount: Number(statsBase.totalCount || 0),
      totalBonus: Number(statsBase.totalBonus || 0),
    };

    const bankReports = (banks as any[]).map((bank: any) => {
      const bankId = bank.id;
      const agg = bankAggMap.get(bankId) || {
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

    const kioskReports = (games as any[]).map((g: any) => {
      const agg =
        gameAggMap.get(g.id) || {
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

    // Build sub brand options for FE
    let subBrandOptions: any[] = [];
    try {
      const requesterId = req.user?.id;
      const requester: any = requesterId
        ? await User.findByPk(requesterId, {
            attributes: ['id', 'tenant_id', 'sub_brand_id', 'is_super_admin'],
            include: [{ model: Role, through: { attributes: [] }, required: false }],
          } as any)
        : null;
      const userRoles = requester?.Roles || [];
      const isSuperAdmin =
        Boolean(req.user?.is_super_admin) ||
        Boolean(requester?.is_super_admin) ||
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
      subBrandOptions,
      partialErrors: {
        banks: false,
        players: false,
        transactions: false,
        games: false,
        bankCatalog: false,
      },
    };

    setCache(cacheKey, summary, 30);
    sendSuccess(res, 'Code1', summary);
  } catch (error) {
    sendError(res, 'Code424', 500); // Failed to load dashboard summary
  }
};

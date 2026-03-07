import { Request, Response } from 'express';
import { Game, GameAdjustment } from '../models';
import { logAudit } from '../services/AuditService';
import { AuthRequest } from '../middleware/auth';
import sequelize from '../config/database';

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

export const getAllGames = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userPermissions = req.user?.permissions || [];
    const canViewGames = (userPermissions as string[]).includes('view:games');
    const games = await Game.findAll({
      where: { status: 'active' },
      order: [['name', 'ASC']]
    });
    const formatted = games.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      status: g.status,
      balance: canViewGames ? Number(g.balance) : null
    }));
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ message: 'Error fetching games' });
  }
};

export const getGamesContext = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userPermissions = req.user?.permissions || [];
    const canViewGames = (userPermissions as string[]).includes('view:games');
    const canViewSensitive = (userPermissions as string[]).includes('view:sensitive_logs');
    const games = await Game.findAll({
      where: { status: 'active' },
      order: [['name', 'ASC']],
    });

    const adjustments = await GameAdjustment.findAll({
      order: [['createdAt', 'DESC']],
    });

    const lastByGame = new Map<number, any>();
    for (const a of adjustments as any[]) {
      const gameId = a.game_id as number;
      if (lastByGame.has(gameId)) continue;
      const amount = a.amount != null ? Number(a.amount) : 0;
      const entry = {
        gameId,
        amount,
        type: a.type,
        reason: canViewSensitive ? a.reason : null,
        operator: a.operator,
        ip: canViewSensitive ? (a.ip_address || null) : null,
        date: a.createdAt,
      };
      lastByGame.set(gameId, entry);
    }

    const formattedGames = games.map((g: any) => {
      const last = lastByGame.get(g.id) || null;
      return {
        id: g.id,
        name: g.name,
        icon: g.icon,
        status: g.status,
        balance: canViewGames ? Number(g.balance) : null,
        lastAdjustment: last,
      };
    });

    res.json({
      generatedAt: new Date().toISOString(),
      games: formattedGames,
    });
  } catch (error) {
    console.error('Error fetching games context:', error);
    res.status(500).json({ message: 'Error fetching games context' });
  }
};

export const createGame = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, balance, icon } = req.body;
    
    if (!name) {
      res.status(400).json({ message: 'Game name is required' });
      return;
    }

    const trimmedName = String(name).trim();

    const existing = await Game.findOne({
      where: { name: trimmedName },
    });

    if (existing) {
      if (existing.status === 'inactive') {
        const original = {
          id: existing.id,
          name: existing.name,
          balance: Number(existing.balance),
          icon: existing.icon,
          status: existing.status,
        };

        // 用当前「添加游戏」表单中的数据覆盖余额和图标
        if (balance !== undefined && balance !== null && balance !== '') {
          (existing as any).balance = balance;
        }
        if (icon !== undefined) {
          (existing as any).icon = icon;
        }
        existing.status = 'active';

        await existing.save();

        await logAudit(
          req.user?.id || null,
          'GAME_RESTORE',
          original,
          {
            id: existing.id,
            name: existing.name,
            balance: Number(existing.balance),
            icon: existing.icon,
            status: existing.status,
          },
          getClientIp(req) || undefined,
        );

        res.status(200).json({
          id: existing.id,
          name: existing.name,
          balance: Number(existing.balance),
          icon: existing.icon,
          status: existing.status,
        });
        return;
      }

      res.status(400).json({ message: 'Game with this name already exists' });
      return;
    }

    const game = await Game.create({
      name: trimmedName,
      balance: balance || 0,
      icon,
      status: 'active'
    });
    await logAudit(req.user?.id || null, 'GAME_CREATE', null, { id: game.id, name: game.name, balance: Number(game.balance), icon: game.icon, status: game.status }, getClientIp(req) || undefined);
    res.status(201).json({ id: game.id, name: game.name, balance: Number(game.balance), icon: game.icon, status: game.status });
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ message: 'Error creating game' });
  }
};

export const deleteGame = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const game = await Game.findByPk(Number(id));
    
    if (!game) {
      res.status(404).json({ message: 'Game not found' });
      return;
    }

    if (game.status === 'inactive') {
      res.json({ message: 'Game already inactive' });
      return;
    }

    const original = {
      id: game.id,
      name: game.name,
      balance: Number(game.balance),
      icon: game.icon,
      status: game.status,
    };

    game.status = 'inactive';
    await game.save();

    await logAudit(
      req.user?.id || null,
      'GAME_ARCHIVE',
      original,
      {
        id: game.id,
        name: game.name,
        balance: Number(game.balance),
        icon: game.icon,
        status: game.status,
      },
      getClientIp(req) || undefined,
    );

    res.json({ message: 'Game set to inactive' });
  } catch (error) {
    console.error('Error deleting game:', error);
    res.status(500).json({ message: 'Error deleting game' });
  }
};

export const adjustBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { amount, type, reason } = req.body;
    const clientIp = getClientIp(req);
    const operatorId = req.user?.id;

    const game = await Game.findByPk(Number(id), {
      transaction: t,
      lock: t.LOCK.UPDATE,
    } as any);
    if (!game) {
      await t.rollback();
      res.status(404).json({ message: 'Game not found' });
      return;
    }

    const beforeBalance = Number(game.balance);
    let afterBalance = beforeBalance;
    const adjustmentAmount = Number(amount);

    if (type === 'TOPUP') {
      afterBalance += adjustmentAmount;
    } else if (type === 'OUT') {
      if (beforeBalance < adjustmentAmount) {
        await t.rollback();
        res.status(400).json({ message: 'Insufficient funds' });
        return;
      }
      afterBalance -= adjustmentAmount;
    } else {
      await t.rollback();
      res.status(400).json({ message: 'Invalid adjustment type' });
      return;
    }

    game.balance = afterBalance;
    await game.save({ transaction: t });

    const operatorName =
      (req.user && (req.user.full_name || req.user.username)) || 'Unknown';

    await GameAdjustment.create({
      game_id: game.id,
      operator_id: operatorId,
      amount: adjustmentAmount,
      type,
      reason,
      operator: operatorName,
      game_balance_after: afterBalance,
      ip_address: clientIp,
    }, { transaction: t });

    await t.commit();
    await logAudit(req.user?.id || null, 'GAME_ADJUST', { id: game.id, beforeBalance, afterBalance, amount: adjustmentAmount, type, reason }, { id: game.id, balance: afterBalance }, clientIp || undefined);
    res.json({ id: game.id, name: game.name, icon: game.icon, status: game.status, balance: Number(game.balance) });
  } catch (error) {
    await t.rollback();
    console.error('Error adjusting game balance:', error);
    res.status(500).json({ message: 'Error adjusting balance' });
  }
};

export const getGameAdjustments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userPermissions = req.user?.permissions || [];
    const canViewSensitive = (userPermissions as string[]).includes('view:sensitive_logs');
    const adjustments = await GameAdjustment.findAll({
      order: [['createdAt', 'DESC']]
    });

    const formatted = adjustments.map((a: any) => {
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
        reason: canViewSensitive ? a.reason : null,
        operator: a.operator,
        ip: canViewSensitive ? (a.ip_address || null) : null,
        beforeBalance,
        afterBalance,
        date: a.createdAt,
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching game adjustments:', error);
    res.status(500).json({ message: 'Error fetching adjustments' });
  }
};

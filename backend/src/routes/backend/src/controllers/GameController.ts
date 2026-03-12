import { Request, Response } from 'express';
import { Game, GameAdjustment } from '../models';
import { logAudit } from '../services/AuditService';
import { AuthRequest } from '../middleware/auth';
import sequelize from '../config/database';

const isValidUrl = (url: string): boolean => {
  if (!url) return true; // Allow empty/null URLs
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
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
      balance: canViewGames ? Number(g.balance) : null,
      kioskUrl: g.kioskUrl,
      kioskUsername: g.kioskUsername,
      kioskPassword: g.kioskPassword
    }));
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ message: 'G103' });
  }
};

export const getGamesContext = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userPermissions = req.user?.permissions || [];
    const canViewGames = (userPermissions as string[]).includes('view:games');
    const games = await Game.findAll({
      where: { status: 'active' },
      order: [['name', 'ASC']],
    });

    const formattedGames = games.map((g: any) => {
      return {
        id: g.id,
        name: g.name,
        icon: g.icon,
        status: g.status,
        balance: canViewGames ? Number(g.balance) : null,
        kioskUrl: g.kioskUrl,
        kioskUsername: g.kioskUsername,
        kioskPassword: g.kioskPassword,
      };
    });

    res.json({
      generatedAt: new Date().toISOString(),
      games: formattedGames,
    });
  } catch (error) {
    console.error('Error fetching games context:', error);
    res.status(500).json({ message: 'G104' });
  }
};

export const createGame = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, balance, icon, kioskUrl, kioskUsername, kioskPassword } = req.body;
    
    if (!name) {
      res.status(400).json({ message: 'G105' });
      return;
    }

    // Validate kioskUrl if provided
    if (kioskUrl && !isValidUrl(kioskUrl)) {
      res.status(400).json({ message: 'G115' }); // Invalid URL
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
          kioskUrl: existing.kioskUrl,
          kioskUsername: existing.kioskUsername,
          kioskPassword: existing.kioskPassword,
        };

        // 用当前「添加游戏」表单中的数据覆盖余额和图标
        if (balance !== undefined && balance !== null) {
          (existing as any).balance = balance;
        }
        if (icon !== undefined) {
          (existing as any).icon = icon;
        }
        if (kioskUrl !== undefined) {
          (existing as any).kioskUrl = kioskUrl;
        }
        if (kioskUsername !== undefined) {
          (existing as any).kioskUsername = kioskUsername;
        }
        if (kioskPassword !== undefined) {
          (existing as any).kioskPassword = kioskPassword;
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
            kioskUrl: existing.kioskUrl,
            kioskUsername: existing.kioskUsername,
            kioskPassword: existing.kioskPassword,
          },
          getClientIp(req) || undefined,
        );

        res.status(200).json({
          id: existing.id,
          name: existing.name,
          balance: Number(existing.balance),
          icon: existing.icon,
          status: existing.status,
          kioskUrl: existing.kioskUrl,
          kioskUsername: existing.kioskUsername,
          kioskPassword: existing.kioskPassword,
        });
        return;
      }

      res.status(400).json({ message: 'G106' });
      return;
    }

    const game = await Game.create({
      name: trimmedName,
      balance: balance || 0,
      icon,
      kioskUrl,
      kioskUsername,
      kioskPassword,
      status: 'active'
    });
    await logAudit(req.user?.id || null, 'GAME_CREATE', null, { id: game.id, name: game.name, balance: Number(game.balance), icon: game.icon, status: game.status, kioskUrl: game.kioskUrl, kioskUsername: game.kioskUsername, kioskPassword: game.kioskPassword }, getClientIp(req) || undefined);
    res.status(201).json({ id: game.id, name: game.name, balance: Number(game.balance), icon: game.icon, status: game.status, kioskUrl: game.kioskUrl, kioskUsername: game.kioskUsername, kioskPassword: game.kioskPassword });
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ message: 'G107' });
  }
};

export const deleteGame = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userPermissions = req.user?.permissions || [];
    const hasGameOperational = (userPermissions as string[]).includes('action:game_operational');
    
    if (!hasGameOperational) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    const { id } = req.params;
    const game = await Game.findByPk(Number(id));
    
    if (!game) {
      res.status(404).json({ message: 'G101' });
      return;
    }

    if (game.status === 'inactive') {
      res.json({ message: 'G108' });
      return;
    }

    const original = {
      id: game.id,
      name: game.name,
      balance: Number(game.balance),
      icon: game.icon,
      status: game.status,
      kioskUrl: game.kioskUrl,
      kioskUsername: game.kioskUsername,
      kioskPassword: game.kioskPassword,
    };

    game.status = 'inactive';
    await game.save();

    await logAudit(
      req.user?.id || null,
      'GAME_DELETE',
      original,
      {
        id: game.id,
        name: game.name,
        balance: Number(game.balance),
        icon: game.icon,
        status: game.status,
        kioskUrl: game.kioskUrl,
        kioskUsername: game.kioskUsername,
        kioskPassword: game.kioskPassword,
      },
      getClientIp(req) || undefined,
    );

    res.json({ message: 'G109' });
  } catch (error) {
    res.status(500).json({ message: 'G110' });
  }
};

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userPermissions = req.user?.permissions || [];
    const hasGameOperational = (userPermissions as string[]).includes('action:game_operational');
    
    if (!hasGameOperational) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    const { id } = req.params;
    const { icon, kioskUrl, kioskUsername, kioskPassword } = req.body;
    
    const game = await Game.findByPk(Number(id));
    if (!game) {
      res.status(404).json({ message: 'G101' });
      return;
    }

    // Validate kioskUrl if provided
    if (kioskUrl !== undefined && kioskUrl !== null && kioskUrl !== '' && !isValidUrl(kioskUrl)) {
      res.status(400).json({ message: 'G115' }); // Invalid URL
      return;
    }

    const original = game.toJSON();
    
    // Update all provided fields (including empty strings to clear values)
    if (icon !== undefined) {
      game.icon = icon;
    }
    if (kioskUrl !== undefined) {
      game.kioskUrl = kioskUrl;
    }
    if (kioskUsername !== undefined) {
      game.kioskUsername = kioskUsername;
    }
    if (kioskPassword !== undefined) {
      game.kioskPassword = kioskPassword;
    }
    
    await game.save();

    await logAudit(
      req.user?.id || null,
      'GAME_UPDATE',
      original,
      game.toJSON(),
      getClientIp(req) || undefined,
    );

    res.json({
      id: game.id,
      name: game.name,
      icon: game.icon,
      status: game.status,
      balance: Number(game.balance),
      kioskUrl: game.kioskUrl,
      kioskUsername: game.kioskUsername,
      kioskPassword: game.kioskPassword
    });
  } catch (error) {
    console.error('Error updating game:', error);
    res.status(500).json({ message: 'G102' });
  }
};

export const adjustBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  const t = await sequelize.transaction();
  try {
    const userPermissions = req.user?.permissions || [];
    const hasGameOperational = (userPermissions as string[]).includes('action:game_operational');
    
    if (!hasGameOperational) {
      await t.rollback();
      res.status(403).json({ message: 'Access denied' });
      return;
    }

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
      res.status(404).json({ message: 'G101' });
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
        res.status(400).json({ message: 'G111' });
        return;
      }
      afterBalance -= adjustmentAmount;
    } else {
      await t.rollback();
      res.status(400).json({ message: 'G112' });
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
    await logAudit(req.user?.id || null, 'GAME_ADJUST', { id: game.id, beforeBalance, afterBalance, amount: adjustmentAmount, type, reason }, { id: game.id, balance: afterBalance, kioskUrl: game.kioskUrl, kioskUsername: game.kioskUsername, kioskPassword: game.kioskPassword }, clientIp || undefined);
    res.json({ id: game.id, name: game.name, icon: game.icon, status: game.status, balance: Number(game.balance), kioskUrl: game.kioskUrl, kioskUsername: game.kioskUsername, kioskPassword: game.kioskPassword });
  } catch (error) {
    await t.rollback();
    console.error('Error adjusting game balance:', error);
    res.status(500).json({ message: 'G113' });
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
    res.status(500).json({ message: 'G114' });
  }
};

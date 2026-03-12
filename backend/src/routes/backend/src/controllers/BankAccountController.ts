import { Request, Response } from 'express';
import { BankAccount, Transaction, Player, User, BankCatalog } from '../models';
import { Op } from 'sequelize';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';
import sequelize from '../config/database';
import { sanitizePlayerForResponse } from './PlayerController';
import { decrypt, isEncrypted } from '../utils/encryption';

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

export const sanitizeBankAccountForResponse = (account: any, permissions: string[]) => {
  const canViewBalance = permissions.includes('view:bank_balance');
  const canViewFullAccount = permissions.includes('view:bank_full_account');

  const acc = account.toJSON ? account.toJSON() : { ...account };

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
};

export const getBankAccounts = async (req: AuthRequest, res: Response) => {
  try {
    const accounts = (await BankAccount.findAll()).filter((account: any) => account.status !== 'banned');
    
    const userPermissions = req.user?.permissions || [];
    const sanitizedAccounts = accounts.map((account: any) => sanitizeBankAccountForResponse(account, userPermissions));

    res.json(sanitizedAccounts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching bank accounts' });
  }
};

export const getBankContext = async (req: AuthRequest, res: Response) => {
  try {
    const userPermissions = req.user?.permissions || [];
    const canViewBalance = userPermissions.includes('view:bank_balance');
    const canViewSensitive = userPermissions.includes('view:sensitive_logs');
    const canViewUsers = userPermissions.includes('action:user_view');

    const startDateRaw = (req.query.startDate as string) || null;
    const endDateRaw = (req.query.endDate as string) || null;
    const bankIdRaw = (req.query.bankId as string) || null;
    const typeRaw = (req.query.type as string) || null;
    const operatorIdRaw = (req.query.operatorId as string) || null;
    const qRaw = ((req.query.q as string) || '').trim();
    const searchTypeRaw = ((req.query.searchType as string) || '').trim().toLowerCase();
    const pageRaw = (req.query.page as string) || '1';
    const pageSizeRaw = (req.query.pageSize as string) || '50';

    const where: any = {};

    // Helper to parse "yyyy-MM-dd HH:mm:ss" as GMT+8
    const parseDateParam = (val: string) => {
      let s = val.trim();
      // If it looks like "yyyy-MM-dd HH:mm:ss", treat as GMT+8
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        s = s.replace(' ', 'T') + '+08:00';
      }
      return new Date(s);
    };

    const range: any = {};
    let hasRange = false;
    if (startDateRaw) {
      const start = parseDateParam(startDateRaw);
      if (!Number.isNaN(start.getTime())) {
        range[Op.gte] = start;
        hasRange = true;
      }
    }
    if (endDateRaw) {
      const end = parseDateParam(endDateRaw);
      if (!Number.isNaN(end.getTime())) {
        range[Op.lte] = end;
        hasRange = true;
      }
    }

    const hasTextSearch = qRaw.length > 0;
    const hasInlineFilters =
      (operatorIdRaw && !Number.isNaN(Number(operatorIdRaw))) ||
      (typeRaw && typeRaw !== 'ALL');

    if (hasTextSearch) {
      if (searchTypeRaw === 'transaction_id') {
        if (hasRange) {
          where.created_at = range;
        }
      } else {
        if (hasRange) {
          where.created_at = range;
        } else {
          const now = new Date();
          const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          where.created_at = { [Op.gte]: startToday, [Op.lte]: endToday };
        }
      }
    } else if (hasRange) {
      where.created_at = range;
    } else {
      if (hasInlineFilters || !hasTextSearch) {
        const now = new Date();
        const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        where.created_at = { [Op.gte]: startToday, [Op.lte]: endToday };
      }
    }

    if (bankIdRaw && bankIdRaw !== 'all') {
      const bankIdNum = Number(bankIdRaw);
      if (!Number.isNaN(bankIdNum)) {
        where.bank_account_id = bankIdNum;
      }
    }

    if (typeRaw && typeRaw !== 'ALL') {
      where.type = typeRaw;
    }

    if (operatorIdRaw) {
      const operatorIdNum = Number(operatorIdRaw);
      if (!Number.isNaN(operatorIdNum)) {
        where.operator_id = operatorIdNum;
      }
    }

    if (hasTextSearch) {
      const like = `%${qRaw}%`;
      if (searchTypeRaw === 'transaction_id') {
        where.id = { [Op.like]: like };
      } else if (searchTypeRaw === 'player_id') {
        where['$Player.player_game_id$'] = { [Op.like]: like };
      }
    }

    const page = Math.max(1, parseInt(pageRaw, 10) || 1);
    const pageSizeBase = parseInt(pageSizeRaw, 10);
    const pageSize =
      Number.isNaN(pageSizeBase) || pageSizeBase <= 0
        ? 50
        : Math.min(pageSizeBase, 200);
    const offset = (page - 1) * pageSize;

    const includePlayer = {
      model: Player,
      required: hasTextSearch && searchTypeRaw === 'player_id',
    } as any;

    const [accountsRaw, txResult, catalog, allOperators] = await Promise.all([
      BankAccount.findAll(),
      Transaction.findAndCountAll({
        where,
        include: [
          { model: BankAccount },
          includePlayer,
          { model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] },
        ],
        order: [['created_at', 'DESC']],
        limit: pageSize,
        offset,
        distinct: true,
      } as any),
      BankCatalog.findAll({
        order: [['name', 'ASC']],
      }),
      canViewUsers ? User.findAll({
        attributes: ['id', 'username', 'full_name'],
        where: { status: 'active' },
        order: [['username', 'ASC']],
      }) : []
    ]);

    const accounts = (accountsRaw as any[]).filter((account) => account.status !== 'banned');
    const bankAccounts = (accounts as any[]).map((account) =>
      sanitizeBankAccountForResponse(account, userPermissions),
    );

    const transactions = (txResult.rows as any[]) || [];
    const total = typeof txResult.count === 'number' ? txResult.count : (txResult.count as any[]).length;

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

    const shapedTransactions = transactions.map((tx: any) => {
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

      const remark = json.remark;
      const bankAfterRaw = json.bank_balance_after;

      let amount: number | null = json.amount != null ? Number(json.amount) : null;
      let bankAfter: number | null = null;

      if (!canViewBalance) {
        amount = null;
        bankAfter = null;
      } else if (bankAfterRaw != null) {
        bankAfter = Number(bankAfterRaw);
      }

      const shaped: any = {
        id: json.id,
        createdAt: json.createdAt ?? json.created_at ?? null,
        type: json.type,
        amount,
        bank_account_id: json.bank_account_id ?? null,
        player_id: json.player_id ?? null,
        remark: canViewSensitive ? remark : null,
        status: json.status ?? null,
        bank_balance_after: bankAfter,
      };

      if (json.Player) {
        shaped.Player = {
          id: json.Player.id,
          gameId: json.Player.gameId ?? null,
        };
      }

      if (json.operator) {
        const rawFullName =
          typeof json.operator.full_name === 'string' && json.operator.full_name.trim().length > 0
            ? json.operator.full_name.trim()
            : null;
        const displayFullName = rawFullName && isEncrypted(rawFullName) ? decrypt(rawFullName) : rawFullName;

        shaped.operator = {
          id: json.operator.id,
          full_name: displayFullName ?? null,
        };
      }

      return shaped;
    });

    const bankCatalog = (catalog as any[]).map((c: any) => ({
      id: c.id,
      name: c.name,
      icon: c.icon || null,
    }));

    res.json({
      bankAccounts,
      transactions: shapedTransactions,
      bankCatalog,
      operatorOptions,
      pagination: {
        page,
        pageSize,
        total,
      },
    });
  } catch (error) {
    console.error('Error fetching bank context', error);
    res.status(500).json({ message: 'Error fetching bank context' });
  }
};

export const createBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const { bank_name, alias, account_number, total_balance } = req.body;

    let cleaned = typeof account_number === 'string' ? account_number.replace(/\D/g, '') : '';

    if (!cleaned || cleaned.length < 4) {
      return res.status(400).json({ message: 'Account number must contain at least 4 digits' });
    }

    const allAccounts = await BankAccount.findAll();
    const existing = allAccounts.find(
      (a: any) => a.bank_name === bank_name && a.account_number === cleaned
    );

    if (existing) {
      const originalData = existing.toJSON();
      existing.bank_name = bank_name;
      existing.alias = alias;
      existing.account_number = cleaned;
      existing.total_balance = total_balance || 0;
      existing.status = 'active';
      await existing.save();

      await logAudit(req.user?.id, 'BANK_UPDATE', originalData, existing.toJSON(), getClientIp(req) || undefined);

      const userPermissions = req.user?.permissions || [];
      return res.json(sanitizeBankAccountForResponse(existing, userPermissions));
    }

    const account = await BankAccount.create({
      bank_name,
      alias,
      account_number: cleaned,
      total_balance: total_balance || 0,
      status: 'active',
    });

    await logAudit(req.user?.id, 'BANK_CREATE', null, account.toJSON(), getClientIp(req) || undefined);

    const userPermissions = req.user?.permissions || [];
    res.status(201).json(sanitizeBankAccountForResponse(account, userPermissions));
  } catch (error) {
    res.status(500).json({ message: 'Error creating bank account' });
  }
};

export const updateBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { bank_name, alias, status, account_number } = req.body;
    const account = await BankAccount.findByPk(Number(id));
    
    if (!account) {
      return res.status(404).json({ message: 'Bank account not found' });
    }
    const originalData = account.toJSON();
    const updates: any = { bank_name, alias, status };

    if (typeof account_number === 'string') {
      const cleaned = account_number.replace(/\D/g, '');
      if (cleaned.length >= 4) {
        updates.account_number = cleaned;
      }
    }
    await account.update(updates);
    
    await logAudit(req.user?.id, 'BANK_UPDATE', originalData, account.toJSON(), getClientIp(req) || undefined);

    const userPermissions = req.user?.permissions || [];
    res.json(sanitizeBankAccountForResponse(account, userPermissions));
  } catch (error) {
    res.status(500).json({ message: 'Error updating bank account' });
  }
};

export const deleteBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const account = await BankAccount.findByPk(Number(id));

    if (!account) {
      return res.status(404).json({ message: 'Bank account not found' });
    }

    const originalData = account.toJSON();

    await account.update({ status: 'banned' });

    await logAudit(req.user?.id, 'BANK_DELETE', originalData, account.toJSON(), getClientIp(req) || undefined);

    res.json({ message: 'Bank account banned' });
  } catch (error: any) {
    console.error('Error deleting bank account:', error);
    res.status(500).json({ message: error.message || 'Error deleting bank account' });
  }
};

export const adjustBalance = async (req: AuthRequest, res: Response) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { amount, reason } = req.body; // amount can be positive or negative
    const clientIp = getClientIp(req);
    
    const account = await BankAccount.findByPk(Number(id), {
      transaction: t,
      lock: t.LOCK.UPDATE,
    } as any);
    if (!account) {
      throw new Error('Bank account not found');
    }

    const originalBalance = Number(account.total_balance);
    const adjustmentAmount = Number(amount);
    
    const newBalance = originalBalance + adjustmentAmount;
    
    // Update Account
    account.total_balance = newBalance;
    await account.save({ transaction: t });

    // Create Adjustment Transaction
    // @ts-ignore
    await Transaction.create({
      bank_account_id: account.id,
      operator_id: req.user.id,
      type: 'ADJUSTMENT',
      amount: adjustmentAmount, // Store signed amount
      bonus: 0,
      tips: 0,
      walve: 0,
      status: 'COMPLETED',
      remark: reason || 'Manual Adjustment',
      ip_address: clientIp,
      player_id: null,
      bank_balance_after: newBalance,
      // Bank Adjustment 与 Game 无关，为避免旧表 NOT NULL 约束，写 0
      game_balance_after: 0,
    }, { transaction: t });

    await t.commit();
    
    await logAudit(req.user?.id, 'BANK_ADJUST', { originalBalance }, { newBalance, reason }, clientIp || undefined);

    const userPermissions = req.user?.permissions || [];
    const canViewBalance = userPermissions.includes('view:bank_balance');
    res.json({ message: 'Balance adjusted', new_balance: canViewBalance ? newBalance : null });
  } catch (error: any) {
    if (!(t as any).finished) await t.rollback();
    console.error('Error adjusting balance:', error);
    res.status(500).json({ message: error.message || 'Error adjusting balance' });
  }
};

export const getBankActivity = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const bankId = Number(id);
    if (Number.isNaN(bankId)) {
      return res.status(400).json({ message: 'Invalid bank account id' });
    }

    const userPermissions = req.user?.permissions || [];
    const canViewBalance = userPermissions.includes('view:bank_balance');
    const canViewSensitive = userPermissions.includes('view:sensitive_logs');

    const transactions = await Transaction.findAll({
      where: { bank_account_id: bankId },
      include: [
        { model: BankAccount },
        { model: Player },
        { model: User, as: 'operator', attributes: ['id', 'full_name'] },
      ],
      order: [['created_at', 'DESC']],
      limit: 500,
    } as any);

    const shaped = transactions.map((tx: any) => {
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

      const remark = json.remark;
      const ip = json.ip_address || null;
      const bankAfterRaw = json.bank_balance_after;

      delete json.ip_address;

      let amount: number | null = json.amount != null ? Number(json.amount) : null;
      let bankAfter: number | null = null;

      if (!canViewBalance) {
        amount = null;
        bankAfter = null;
      } else if (bankAfterRaw != null) {
        bankAfter = Number(bankAfterRaw);
      }

      json.amount = amount;
      json.remark = canViewSensitive ? remark : null;
      json.ip = canViewSensitive ? ip : null;
      json.bank_balance_after = bankAfter;

      // 移除bonus字段，不对外暴露
      delete json.bonus;

      if (json.operator) {
        const rawFullName =
          typeof json.operator.full_name === 'string' && json.operator.full_name.trim().length > 0
            ? json.operator.full_name.trim()
            : null;
        const displayFullName = rawFullName && isEncrypted(rawFullName) ? decrypt(rawFullName) : rawFullName;

        json.operator = {
          id: json.operator.id,
          full_name: displayFullName ?? null,
        };
      }

      return json;
    });

    res.json(shaped);
  } catch (error) {
    console.error('Error fetching bank activity', error);
    res.status(500).json({ message: 'Error fetching bank activity' });
  }
};

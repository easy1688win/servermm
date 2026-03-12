import { Request, Response } from 'express';
import { Player, Game, BankCatalog, Setting, User, PlayerStats } from '../models';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';
import { Op } from 'sequelize';
import sequelize from '../config/database';
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

const extractPhoneNumber = (metadata: any): string | null => {
  if (!metadata) return null;
  const phoneNumber = metadata.phoneNumber || '';
  return phoneNumber.trim() || null;
};

const extractBankKeys = (metadata: any): Set<string> => {
  const keys = new Set<string>();
  if (!metadata) return keys;
  if (Array.isArray(metadata.playerBanks)) {
    for (const pb of metadata.playerBanks) {
      const bankName = (pb?.bankName || '').trim().toLowerCase();
      const acc = (pb?.accountNumber || '').trim();
      if (!bankName || !acc) continue;
      keys.add(bankName + '|' + acc);
    }
  }
  return keys;
};

const extractGameKeys = (metadata: any): Set<string> => {
  const keys = new Set<string>();
  if (!metadata) return keys;
  if (Array.isArray(metadata.gameAccounts)) {
    for (const ga of metadata.gameAccounts) {
      const gameName = (ga?.gameName || '').trim().toLowerCase();
      const id = (ga?.accountId || '').trim().toLowerCase();
      if (!gameName || !id) continue;
      keys.add(gameName + '|' + id);
    }
  }
  return keys;
};

const validateMetadata = (metadata: any): string | null => {
  if (!metadata) return null;

  if (Array.isArray(metadata.playerBanks)) {
    const seen = new Set<string>();
    for (const pb of metadata.playerBanks) {
      const bankName = (pb?.bankName || '').trim().toLowerCase();
      const acc = (pb?.accountNumber || '').trim();
      if (!bankName || !acc) continue;
      const key = bankName + '|' + acc;
      if (seen.has(key)) {
        return 'P105';
      }
      seen.add(key);
    }
  }

  if (Array.isArray(metadata.gameAccounts)) {
    const seen = new Set<string>();
    for (const ga of metadata.gameAccounts) {
      const gameName = (ga?.gameName || '').trim().toLowerCase();
      const id = (ga?.accountId || '').trim().toLowerCase();
      if (!gameName || !id) continue;
      const key = gameName + '|' + id;
      if (seen.has(key)) {
        return 'P106';
      }
      seen.add(key);
    }
  }

  return null;
};

const checkGlobalPhoneNumberConflict = async (
  phoneNumber: string,
  excludePlayerId?: number
): Promise<string | null> => {
  if (!phoneNumber) return null;

  const players = await Player.findAll({
    attributes: ['id', 'metadata'],
  });

  for (const p of players) {
    const anyPlayer: any = p as any;
    if (excludePlayerId && anyPlayer.id === excludePlayerId) continue;
    const meta = anyPlayer.metadata;
    if (!meta) continue;

    const otherPhoneNumber = extractPhoneNumber(meta);
    if (otherPhoneNumber && otherPhoneNumber === phoneNumber) {
      return 'P110'; // Phone Number already exists
    }
  }

  return null;
};

const checkGlobalMetadataConflicts = async (
  bankKeys: Set<string>,
  gameKeys: Set<string>,
  excludePlayerId?: number
): Promise<string | null> => {
  if (bankKeys.size === 0 && gameKeys.size === 0) return null;

  const players = await Player.findAll({
    attributes: ['id', 'player_game_id', 'metadata'],
  });

  const bankKeyArr = Array.from(bankKeys);
  const gameKeyArr = Array.from(gameKeys);

  for (const p of players) {
    const anyPlayer: any = p as any;
    if (excludePlayerId && anyPlayer.id === excludePlayerId) continue;
    const meta = anyPlayer.metadata;
    if (!meta) continue;

    if (bankKeyArr.length > 0) {
      const otherBankKeys = extractBankKeys(meta);
      const conflict = bankKeyArr.some(k => otherBankKeys.has(k));
      if (conflict) {
        return 'P102';
      }
    }

    if (gameKeyArr.length > 0) {
      const otherGameKeys = extractGameKeys(meta);
      const conflict = gameKeyArr.some(k => otherGameKeys.has(k));
      if (conflict) {
        return 'P103';
      }
    }
  }

  return null;
};

const validateMetadataGlobalForCreate = async (metadata: any): Promise<string | null> => {
  if (!metadata) return null;
  
  // Check Phone Number uniqueness
  const phoneNumber = extractPhoneNumber(metadata);
  if (phoneNumber) {
    const phoneConflict = await checkGlobalPhoneNumberConflict(phoneNumber);
    if (phoneConflict) return phoneConflict;
  }
  
  const bankKeys = extractBankKeys(metadata);
  const gameKeys = extractGameKeys(metadata);
  return checkGlobalMetadataConflicts(bankKeys, gameKeys);
};

const validateMetadataGlobalForUpdate = async (
  newMetadata: any,
  oldMetadata: any,
  playerId: number
): Promise<string | null> => {
  if (!newMetadata) return null;

  // Check Phone Number uniqueness
  const newPhoneNumber = extractPhoneNumber(newMetadata);
  const oldPhoneNumber = extractPhoneNumber(oldMetadata || null);
  
  if (newPhoneNumber && newPhoneNumber !== oldPhoneNumber) {
    const phoneConflict = await checkGlobalPhoneNumberConflict(newPhoneNumber, playerId);
    if (phoneConflict) return phoneConflict;
  }

  const newBankKeys = extractBankKeys(newMetadata);
  const newGameKeys = extractGameKeys(newMetadata);
  const oldBankKeys = extractBankKeys(oldMetadata || null);
  const oldGameKeys = extractGameKeys(oldMetadata || null);

  const diffBankKeys = new Set<string>();
  newBankKeys.forEach(k => {
    if (!oldBankKeys.has(k)) diffBankKeys.add(k);
  });

  const diffGameKeys = new Set<string>();
  newGameKeys.forEach(k => {
    if (!oldGameKeys.has(k)) diffGameKeys.add(k);
  });

  return checkGlobalMetadataConflicts(diffBankKeys, diffGameKeys, playerId);
};

export const sanitizePlayerForResponse = (player: any, permissions: string[]) => {
  const canViewProfit = permissions.includes('view:player_profit');
  const canViewPlayerBanks = permissions.includes('view:player_banks');
  const json = player.toJSON ? player.toJSON() : { ...player };

  if (json.metadata) {
    const { createdByUsername, ...restMeta } = json.metadata;
    json.metadata = restMeta;
  }

  if (!canViewProfit) {
    if (Object.prototype.hasOwnProperty.call(json, 'total_in')) {
      json.total_in = null;
    }
    if (Object.prototype.hasOwnProperty.call(json, 'total_out')) {
      json.total_out = null;
    }
  }

  if (!canViewPlayerBanks && json.metadata && Array.isArray(json.metadata.playerBanks)) {
    json.metadata = {
      ...json.metadata,
      playerBanks: json.metadata.playerBanks.map((pb: any) => ({
        ...pb,
        accountNumber: '****',
      })),
    };
  }

  return json;
};

export const getPlayers = async (req: AuthRequest, res: Response) => {
  try {
    const players = await Player.findAll({
      include: [{ model: Game, attributes: ['id', 'name'] }]
    });
    
    const userPermissions = req.user?.permissions || [];
    const sanitizedPlayers = players.map((player: any) => sanitizePlayerForResponse(player, userPermissions));

    await logAudit(
      req.user?.id ?? null,
      'PLAYER_LIST',
      null,
      { count: sanitizedPlayers.length },
      getClientIp(req) || null
    );

    res.json(sanitizedPlayers);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching players' });
  }
};

export const getPlayerList = async (req: AuthRequest, res: Response) => {
  try {
    const userPermissions = req.user?.permissions || [];
    const canViewProfit = userPermissions.includes('view:player_profit');
    const canViewUsers = userPermissions.includes('action:user_view');

    const startDateRaw = (req.query.startDate as string | undefined) || null;
    const endDateRaw = (req.query.endDate as string | undefined) || null;

    // Helper to parse "yyyy-MM-dd HH:mm:ss" as GMT+8
    const parseDateParam = (val: string) => {
      let s = val.trim();
      // If it looks like "yyyy-MM-dd HH:mm:ss", treat as GMT+8
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        s = s.replace(' ', 'T') + '+08:00';
      }
      return new Date(s);
    };

    const pageRaw = (req.query.page as string) || '1';
    const pageSizeRaw = (req.query.pageSize as string) || '50';
    let page = parseInt(pageRaw, 10);
    let pageSize = parseInt(pageSizeRaw, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 50;
    if (pageSize > 200) pageSize = 200;

    const searchQuery = (req.query.q as string || '').trim();
    const searchType = (req.query.searchType as string || '').trim();
    const filterOpId = (req.query.operatorId as string || '').trim();
    const filterSource = (req.query.referralSource as string || '').trim();
    const filterTag = (req.query.tags as string || '').trim();

    const createdCond: any = {};
    let hasRange = false;
    if (startDateRaw) {
      const d = parseDateParam(startDateRaw);
      if (!Number.isNaN(d.getTime())) {
        createdCond[Op.gte] = d;
        hasRange = true;
      }
    }
    if (endDateRaw) {
      const d = parseDateParam(endDateRaw);
      if (!Number.isNaN(d.getTime())) {
        createdCond[Op.lte] = d;
        hasRange = true;
      }
    }
    const hasTextSearch = searchQuery.length > 0;
    const effectiveSearchType = searchType || 'player_game_id';

    const whereConditions: any[] = [];

    if (!hasTextSearch && hasRange) {
      whereConditions.push({ createdAt: createdCond });
    }

    if (filterTag) {
      whereConditions.push(
        sequelize.where(
          sequelize.fn(
            'JSON_CONTAINS',
            sequelize.col('tags'),
            JSON.stringify(filterTag),
            '$',
          ),
          1,
        ),
      );
    }

    if (hasTextSearch && effectiveSearchType === 'player_game_id') {
      whereConditions.push({
        player_game_id: { [Op.like]: `%${searchQuery}%` },
      });
    }

    const finalWhere: any =
      whereConditions.length > 0 ? { [Op.and]: whereConditions } : {};

    const [
      playersRaw,
      allPlayersRaw,
      statsRows,
      games,
      bankCatalog,
      referralSetting,
      tagSetting,
      allOperators
    ] = await Promise.all([
      // 用于当前列表显示的玩家（按注册时间过滤并包含游戏信息）
      Player.findAll({
        where: finalWhere,
        include: [{ model: Game, attributes: ['id', 'name'] }],
      }),
      // 全量玩家，用于计算 Referrals 统计，不受当前筛选影响
      Player.findAll({
        attributes: ['id', 'player_game_id', 'metadata', 'createdAt'],
      }),
      // PlayerStats 在这里按“全历史”聚合，不受日期筛选影响
      PlayerStats.findAll() as any,
      Game.findAll({
        attributes: ['id', 'name', 'icon', 'status'],
        where: { status: 'active' },
      }),
      BankCatalog.findAll(),
      Setting.findByPk('referralSources'),
      Setting.findByPk('tagOptions'),
      canViewUsers ? User.findAll({
        attributes: ['id', 'username', 'full_name'],
        where: { status: 'active' } // Optional: filter active only
      }) : []
    ]);

    const normalizeDigits = (val: string) => String(val || '').replace(/\D/g, '');
    const qLower = searchQuery.toLowerCase();
    const qDigits = normalizeDigits(searchQuery);
    const sourceLower = filterSource.toLowerCase();
    const operatorIdNum =
      filterOpId && !Number.isNaN(Number(filterOpId)) ? Number(filterOpId) : null;

    let players = (playersRaw as any[]).filter((p) => {
      const json = p?.toJSON ? p.toJSON() : p;
      const meta = json?.metadata && typeof json.metadata === 'object' ? json.metadata : {};
      const tags = Array.isArray(json?.tags) ? json.tags : [];

      if (filterTag) {
        if (!tags.includes(filterTag)) return false;
      }

      if (operatorIdNum != null) {
        const createdBy = meta.createdByUserId;
        if (createdBy !== operatorIdNum) return false;
      }

      if (filterSource) {
        const src = String(meta.referralSource || '').toLowerCase();
        if (src !== sourceLower) return false;
      }

      if (!hasTextSearch) return true;

      if (effectiveSearchType === 'player_game_id') {
        return true;
      }

      if (effectiveSearchType === 'bank_account') {
        const banks = Array.isArray(meta.playerBanks) ? meta.playerBanks : [];
        if (!qDigits) return false;
        return banks.some((b: any) => normalizeDigits(b?.accountNumber).includes(qDigits));
      }

      if (effectiveSearchType === 'game_account') {
        const gamesArr = Array.isArray(meta.gameAccounts) ? meta.gameAccounts : [];
        if (!qLower) return false;
        return gamesArr.some((g: any) =>
          String(g?.accountId || '').toLowerCase().includes(qLower),
        );
      }

      if (effectiveSearchType === 'phone') {
        if (!qDigits) return false;
        return normalizeDigits(meta.phoneNumber).includes(qDigits);
      }

      if (effectiveSearchType === 'full_name') {
        if (!qLower) return false;
        return String(meta.fullName || '').toLowerCase().includes(qLower);
      }

      return false;
    });

    const createdByIds = new Set<number>();
    for (const p of players as any[]) {
      const meta = (p as any).metadata || {};
      const id = meta.createdByUserId;
      if (typeof id === 'number' && Number.isFinite(id)) {
        createdByIds.add(id);
      }
    }
    
    // Create map from allOperators instead of fetching again
    const createdByUserMap = new Map(
        (allOperators as any[]).map((u) => [
          u.id,
          {
            full_name:
              typeof u.full_name === 'string' && u.full_name.trim().length > 0
                ? u.full_name.trim()
                : null,
            username: u.username // Also store username
          },
        ])
    );


    type AggregatedStats = {
      lastDepositDate: string | null;
      lastWithdrawDate: string | null;
      depositCount: number;
      withdrawCount: number;
      totalDeposit: number;
      totalWithdraw: number;
      totalWalve: number;
      totalTips: number;
      totalBonus: number;
    };

    const statsMap = new Map<number, AggregatedStats>();

    for (const row of statsRows as any[]) {
      const playerId = row.player_id as number | null | undefined;
      if (!playerId) continue;

      const existing = statsMap.get(playerId);
      const depositCount = Number(row.deposit_count || 0);
      const withdrawCount = Number(row.withdraw_count || 0);
      const totalDeposit = Number(row.total_deposit || 0);
      const totalWithdraw = Number(row.total_withdraw || 0);
      const totalWalve = Number(row.total_walve || 0);
      const totalTips = Number(row.total_tips || 0);
      const totalBonus = Number(row.total_bonus || 0);
      const lastDepositAt = row.last_deposit_at
        ? new Date(row.last_deposit_at)
        : null;
      const lastWithdrawAt = row.last_withdraw_at
        ? new Date(row.last_withdraw_at)
        : null;

      if (!existing) {
        statsMap.set(playerId, {
          lastDepositDate: lastDepositAt ? lastDepositAt.toISOString() : null,
          lastWithdrawDate: lastWithdrawAt ? lastWithdrawAt.toISOString() : null,
          depositCount,
          withdrawCount,
          totalDeposit,
          totalWithdraw,
          totalWalve,
          totalTips,
          totalBonus,
        });
      } else {
        const next: AggregatedStats = {
          lastDepositDate: existing.lastDepositDate,
          lastWithdrawDate: existing.lastWithdrawDate,
          depositCount: existing.depositCount + depositCount,
          withdrawCount: existing.withdrawCount + withdrawCount,
          totalDeposit: existing.totalDeposit + totalDeposit,
          totalWithdraw: existing.totalWithdraw + totalWithdraw,
          totalWalve: existing.totalWalve + totalWalve,
          totalTips: existing.totalTips + totalTips,
          totalBonus: existing.totalBonus + totalBonus,
        };

        if (lastDepositAt) {
          if (
            !next.lastDepositDate ||
            lastDepositAt.toISOString() > next.lastDepositDate
          ) {
            next.lastDepositDate = lastDepositAt.toISOString();
          }
        }

        if (lastWithdrawAt) {
          if (
            !next.lastWithdrawDate ||
            lastWithdrawAt.toISOString() > next.lastWithdrawDate
          ) {
            next.lastWithdrawDate = lastWithdrawAt.toISOString();
          }
        }

        statsMap.set(playerId, next);
      }
    }

    type ReferralStatEntry = {
      playerId: number;
      playerGameId: string;
      joinedAt: string | null;
      totalDeposit: number | null;
      totalWithdraw: number | null;
    };

    const referralStatsMap = new Map<number, ReferralStatEntry[]>();

    for (const p of allPlayersRaw as any[]) {
      const playerId = p.id as number | undefined;
      if (!playerId) continue;

      const metadata = (p.metadata || {}) as any;
      const referrerId = metadata.referrerId;
      if (typeof referrerId !== 'number' || !Number.isFinite(referrerId)) {
        continue;
      }

      const stats = statsMap.get(playerId) || {
        lastDepositDate: null,
        lastWithdrawDate: null,
        depositCount: 0,
        withdrawCount: 0,
        totalDeposit: 0,
        totalWithdraw: 0,
        totalWalve: 0,
        totalTips: 0,
        totalBonus: 0,
      };

      const joinedRaw = (p as any).createdAt || (p as any).created_at || null;
      const joinedAt =
        joinedRaw instanceof Date
          ? joinedRaw.toISOString()
          : typeof joinedRaw === 'string'
          ? joinedRaw
          : null;

      const entry: ReferralStatEntry = {
        playerId,
        playerGameId: String(p.player_game_id || ''),
        joinedAt,
        totalDeposit: canViewProfit ? stats.totalDeposit : null,
        totalWithdraw: canViewProfit ? stats.totalWithdraw : null,
      };

      const arr = referralStatsMap.get(referrerId) || [];
      arr.push(entry);
      referralStatsMap.set(referrerId, arr);
    }

    const sanitizedPlayers = players.map((p: any) =>
      sanitizePlayerForResponse(p, userPermissions)
    );

    const playersPayloadAll = (sanitizedPlayers as any[]).map((p) => {
      const json = p.toJSON ? p.toJSON() : { ...p };

      const metadataRaw = json.metadata || {};
      const createdByUserId = metadataRaw.createdByUserId;
      let createdByFullName: string | null = null;
      if (typeof createdByUserId === 'number' && Number.isFinite(createdByUserId)) {
        const u = createdByUserMap.get(createdByUserId);
        if (u) {
          // Prioritize full_name, fallback to username if full_name is missing/empty
          createdByFullName = u.full_name || u.username || null;
        }
      }
      const metadata = {
        ...metadataRaw,
        createdByFullName,
      };

      const stats = statsMap.get(json.id) || {
        lastDepositDate: null,
        lastWithdrawDate: null,
        depositCount: 0,
        withdrawCount: 0,
        totalDeposit: 0,
        totalWithdraw: 0,
        totalWalve: 0,
        totalTips: 0,
        totalBonus: 0,
      };

      const netProfit =
        canViewProfit && stats
          ? stats.totalDeposit - stats.totalWithdraw
          : null;

      const referralStatsRaw = referralStatsMap.get(json.id) || [];
      const referralStats = referralStatsRaw.map((r) => ({
        playerId: r.playerId,
        player_game_id: r.playerGameId,
        joinedAt: r.joinedAt,
        totalDeposit: r.totalDeposit,
        totalWithdraw: r.totalWithdraw,
      }));

      let tags = json.tags;
      if (typeof tags === 'string') {
        try {
          tags = JSON.parse(tags);
        } catch (e) {
          tags = [];
        }
      }
      if (!Array.isArray(tags)) tags = [];

      return {
        id: json.id,
        player_game_id: json.player_game_id,
        tags,
        metadata,
        netProfit,
        created_at: json.created_at || json.createdAt || null,
        updated_at: json.updated_at || json.updatedAt || null,
        stats: {
          lastDepositDate: stats.lastDepositDate,
          lastWithdrawDate: stats.lastWithdrawDate,
          depositCount: stats.depositCount,
          withdrawCount: stats.withdrawCount,
          totalDeposit: canViewProfit ? stats.totalDeposit : null,
          totalWithdraw: canViewProfit ? stats.totalWithdraw : null,
        },
        bonusStats: {
          totalWalve: canViewProfit ? stats.totalWalve : null,
          totalTips: canViewProfit ? stats.totalTips : null,
          totalBonus: canViewProfit ? stats.totalBonus : null,
        },
        referralStats,
      };
    });

    // Remove secondary manual filtering as Sequelize WHERE clause is now robust
    const playersPayload = playersPayloadAll;

    const bankNameOptions = (bankCatalog as any[])
      .map((b) => (b && typeof b.name === 'string' ? b.name : null))
      .filter((name): name is string => !!name && name.trim().length > 0);

    const gameNameOptions = (games as any[])
      .map((g) => (g && typeof g.name === 'string' ? g.name : null))
      .filter((name): name is string => !!name && name.trim().length > 0);

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
    
    // Add operator options for frontend filter
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

    let referralValue = referralSetting?.get('value') as any;
    // Handle double-encoded JSON string for referralSources
    if (typeof referralValue === 'string' && referralValue.startsWith('[')) {
      try {
        referralValue = JSON.parse(referralValue);
      } catch (e) { /* ignore */ }
    }

    const referralSourceOptions = Array.isArray(referralValue)
      ? referralValue.filter(
          (v: any) => typeof v === 'string' && v.trim().length > 0
        )
      : [];

    let tagValue = tagSetting?.get('value') as any;
    // Handle double-encoded JSON string for tagOptions
    if (typeof tagValue === 'string' && tagValue.startsWith('[')) {
      try {
        tagValue = JSON.parse(tagValue);
      } catch (e) { /* ignore */ }
    }

    const tagOptions = Array.isArray(tagValue)
      ? tagValue
          .filter((t: any) => t && typeof t.name === 'string')
          .map((t: any) => ({
            name: t.name,
            color: t.color || '#3B82F6',
          }))
      : [];

    const totalItems = playersPayload.length;
    const totalPages =
      totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
    if (page > totalPages && totalPages > 0) {
      page = totalPages;
    }
    const startIndex = (page - 1) * pageSize;
    const pagedPlayers =
      totalItems === 0 ? [] : playersPayload.slice(startIndex, startIndex + pageSize);

    await logAudit(
      req.user?.id ?? null,
      'PLAYER_LIST_VIEW',
      null,
      {
        count: totalItems,
        startDate: startDateRaw,
        endDate: endDateRaw,
        page,
        pageSize,
        q: searchQuery,
      },
      getClientIp(req) || null
    );

    res.json({
      players: pagedPlayers,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
      bankNameOptions,
      gameNameOptions,
      gameIconMap,
      bankIconMap,
      referralSourceOptions,
      tagOptions,
      operatorOptions,
    });
  } catch (error) {
    console.error('Error fetching player list:', error);
    res.status(500).json({ message: 'Error fetching player list' });
  }
};

export const searchPlayers = async (req: AuthRequest, res: Response) => {
  try {
    const qRaw = (req.query.q as string | undefined) || '';
    const q = qRaw.trim();
    if (!q) {
      res.json([]);
      return;
    }

    const limit = 50;

    const players = await Player.findAll({
      where: {
        player_game_id: {
          [Op.like]: `%${q}%`,
        },
      },
      include: [{ model: Game, attributes: ['id', 'name'] }],
      order: [['id', 'DESC']],
      limit,
    } as any);

    const userPermissions = req.user?.permissions || [];
    const sanitizedPlayers = players.map((player: any) =>
      sanitizePlayerForResponse(player, userPermissions)
    );

    const activeGames = await Game.findAll({
      attributes: ['name'],
      where: { status: 'active' },
    } as any);
    const activeGameNames = new Set(
      (activeGames as any[]).map((g) =>
        String(g.name || '').trim().toLowerCase(),
      ),
    );

    const payload = sanitizedPlayers.map((p: any) => {
      const json = p.toJSON ? p.toJSON() : { ...p };
      const metadata = json.metadata || {};
      const gameAccountsRaw = Array.isArray(metadata.gameAccounts)
        ? metadata.gameAccounts
        : [];
      const gameAccounts = gameAccountsRaw.filter((ga: any) => {
        const name = String(ga?.gameName || '').trim().toLowerCase();
        if (!name) return false;
        return activeGameNames.has(name);
      });
      return {
        id: json.id,
        player_game_id: json.player_game_id,
        gameAccounts,
      };
    });

    await logAudit(
      req.user?.id ?? null,
      'PLAYER_SEARCH',
      { q, limit },
      { count: payload.length },
      getClientIp(req) || null
    );

    res.json(payload);
  } catch (error: any) {
    console.error('Error searching players:', error);
    res.status(500).json({ message: 'Error searching players' });
  }
};

const generateNextPlayerId = async (): Promise<string> => {
  const prefix = 'JK99';
  
  try {
    // Find the player with the highest numeric suffix
    const lastPlayer = await Player.findOne({
      where: {
        player_game_id: {
          [Op.like]: `${prefix}%`
        }
      },
      order: [['player_game_id', 'DESC']],
      attributes: ['player_game_id']
    });

    if (!lastPlayer) {
      // No existing players with this prefix, start with 00001
      return `${prefix}00001`;
    }

    const lastId = lastPlayer.get('player_game_id') as string;
    const numericPart = lastId.replace(prefix, '');
    
    if (!/^\d+$/.test(numericPart)) {
      // Invalid format, start fresh
      return `${prefix}00001`;
    }

    const nextNumber = parseInt(numericPart, 10) + 1;
    const paddedNumber = nextNumber.toString().padStart(5, '0');
    
    return `${prefix}${paddedNumber}`;
  } catch (error) {
    console.error('Error generating next player ID:', error);
    // Fallback to starting with 00001
    return `${prefix}00001`;
  }
};

export const getNextPlayerId = async (req: AuthRequest, res: Response) => {
  try {
    const nextId = await generateNextPlayerId();
    res.json({ nextPlayerId: nextId });
  } catch (error) {
    console.error('Error getting next player ID:', error);
    res.status(500).json({ message: 'Error generating next player ID' });
  }
};

export const createPlayer = async (req: AuthRequest, res: Response) => {
  try {
    const { player_game_id, game_id, tags, metadata } = req.body;
    const userPermissions = req.user?.permissions || [];
    
    // Generate auto player ID if not provided or if provided ID doesn't match the pattern
    const finalPlayerId = player_game_id && player_game_id.startsWith('JK99') 
      ? player_game_id 
      : await generateNextPlayerId();
    
    // Check if player already exists (same ID)
    const existingPlayer = await Player.findOne({ 
      where: { 
        player_game_id: finalPlayerId,
        game_id: game_id || null
      } 
    });
    if (existingPlayer) {
      return res.status(400).json({ message: 'P101' });
    }
    
    const validationError = validateMetadata(metadata);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }
    const globalError = await validateMetadataGlobalForCreate(metadata);
    if (globalError) {
      return res.status(400).json({ message: globalError });
    }
    const canEditPlayerBanks = userPermissions.includes('action:player_banks_edit');

    let baseMetadata = metadata || {};
    if (!canEditPlayerBanks && baseMetadata && typeof baseMetadata === 'object' && Array.isArray((baseMetadata as any).playerBanks)) {
      const cloned = { ...(baseMetadata as any) };
      delete cloned.playerBanks;
      baseMetadata = cloned;
    }

    const enrichedMetadata = {
      ...baseMetadata,
      createdByUserId: req.user?.id,
    };

    const player = await Player.create({
      player_game_id: finalPlayerId,
      game_id: game_id || null,
      tags: tags || [],
      metadata: enrichedMetadata,
      total_in: 0,
      total_out: 0
    });

    await logAudit(req.user?.id, 'PLAYER_CREATE', null, player.toJSON(), req.ip);

    const responsePayload = sanitizePlayerForResponse(player, userPermissions);
    res.status(201).json(responsePayload);
  } catch (error) {
    res.status(500).json({ message: 'Error creating player' });
  }
};

export const updatePlayer = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
    const { player_game_id, game_id, tags, metadata } = req.body;
    const userPermissions = req.user?.permissions || [];
    const playerId = Number(id);

    if (!Number.isInteger(playerId) || playerId <= 0) {
      return res.status(400).json({ message: 'P107' });
    }

    const player = await Player.findByPk(playerId);
    if (!player) {
        return res.status(404).json({ message: 'P104' });
    }

    const originalData = player.toJSON();

    const canEditPlayerBanks = userPermissions.includes('action:player_banks_edit');
    let effectiveMetadata = metadata;
    if (effectiveMetadata && !canEditPlayerBanks && typeof effectiveMetadata === 'object' && Array.isArray((effectiveMetadata as any).playerBanks)) {
      const cloned = { ...(effectiveMetadata as any) };
      delete cloned.playerBanks;
      effectiveMetadata = cloned;
    }

    if (effectiveMetadata) {
      const validationError = validateMetadata(effectiveMetadata);
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }
      const globalError = await validateMetadataGlobalForUpdate(
        effectiveMetadata,
        originalData.metadata,
        player.id
      );
      if (globalError) {
        return res.status(400).json({ message: globalError });
      }
    }
    
    if (player_game_id) player.player_game_id = player_game_id;
    if (tags) player.tags = tags;
    if (effectiveMetadata) player.metadata = effectiveMetadata;

        await player.save();

        await logAudit(req.user?.id, 'PLAYER_UPDATE', originalData, player.toJSON(), req.ip);

        const responsePayload = sanitizePlayerForResponse(player, userPermissions);

        res.json(responsePayload);
    } catch (error) {
        console.error('Error updating player:', error);
        res.status(500).json({ message: 'P108' });
    }
};

export const deletePlayer = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const playerId = Number(id);

        if (!Number.isInteger(playerId) || playerId <= 0) {
          return res.status(400).json({ message: 'Invalid player id' });
        }

        const player = await Player.findByPk(playerId);
        if (!player) {
            return res.status(404).json({ message: 'Player not found' });
        }

        const originalData = player.toJSON();
        await player.destroy();

        await logAudit(req.user?.id, 'PLAYER_DELETE', originalData, null, req.ip);

        res.json({ message: 'Player deleted' });
    } catch (error) {
        console.error('Error deleting player:', error);
        res.status(500).json({ message: 'Error deleting player' });
    }
};

export const getPlayerStatistics = async (req: AuthRequest, res: Response) => {
    try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);

        // Get all players for statistics
        const [allPlayers, allStats] = await Promise.all([
            Player.findAll({
                attributes: ['id', 'player_game_id', 'metadata', 'createdAt'],
            }),
            PlayerStats.findAll() as any
        ]);

        // Create stats map for player activity
        const statsMap = new Map<number, any>();
        for (const row of allStats) {
            const playerId = row.player_id;
            if (!playerId) continue;

            const lastDepositAt = row.last_deposit_at ? new Date(row.last_deposit_at) : null;
            const lastWithdrawAt = row.last_withdraw_at ? new Date(row.last_withdraw_at) : null;
            
            // Get the most recent activity date
            let lastActivity = null;
            if (lastDepositAt && lastWithdrawAt) {
                lastActivity = lastDepositAt > lastWithdrawAt ? lastDepositAt : lastWithdrawAt;
            } else if (lastDepositAt) {
                lastActivity = lastDepositAt;
            } else if (lastWithdrawAt) {
                lastActivity = lastWithdrawAt;
            }

            statsMap.set(playerId, {
                lastActivity,
                depositCount: Number(row.deposit_count || 0),
                withdrawCount: Number(row.withdraw_count || 0),
                totalDeposit: Number(row.total_deposit || 0),
                totalWithdraw: Number(row.total_withdraw || 0),
            });
        }

        // Calculate statistics
        const totalPlayers = allPlayers.length;
        
        // Monthly new players
        const monthlyNewPlayers = allPlayers.filter(player => {
            const createdAt = new Date(player.get('createdAt') as string || player.get('created_at') as string);
            return createdAt >= monthStart && createdAt <= now;
        }).length;

        // Today new players
        const todayNewPlayers = allPlayers.filter(player => {
            const createdAt = new Date(player.get('createdAt') as string || player.get('created_at') as string);
            return createdAt >= todayStart && createdAt <= todayEnd;
        }).length;

        // Today active players (with activity today)
        const todayActivePlayers = Array.from(statsMap.values()).filter(stats => 
            stats.lastActivity && stats.lastActivity >= todayStart && stats.lastActivity <= todayEnd
        ).length;

        // Weekly active players
        const weeklyActivePlayers = Array.from(statsMap.values()).filter(stats => 
            stats.lastActivity && stats.lastActivity >= weekStart && stats.lastActivity <= now
        ).length;

        // 30 days inactive players
        const inactive30DaysPlayers = Array.from(statsMap.values()).filter(stats => 
            !stats.lastActivity || stats.lastActivity < thirtyDaysAgo
        ).length;

        // Calculate retention rates
        const calculateRetention = (days: number) => {
            const cutoffDate = new Date(now);
            cutoffDate.setDate(now.getDate() - days);
            
            const playersInCohort = allPlayers.filter(player => {
                const createdAt = new Date(player.get('createdAt') as string || player.get('created_at') as string);
                return createdAt <= cutoffDate;
            });

            if (playersInCohort.length === 0) return 0;

            const activePlayers = playersInCohort.filter(player => {
                const stats = statsMap.get(player.id);
                return stats && stats.lastActivity && stats.lastActivity >= cutoffDate;
            }).length;

            return Math.round((activePlayers / playersInCohort.length) * 100);
        };

        const retention1Day = calculateRetention(1);
        const retention7Days = calculateRetention(7);
        const retention30Days = calculateRetention(30);

        // Calculate referral source distribution
        const referralSourceMap = new Map<string, number>();
        for (const player of allPlayers) {
            const metadata = player.metadata || {};
            const source = metadata.referralSource || 'Unknown';
            referralSourceMap.set(source, (referralSourceMap.get(source) || 0) + 1);
        }

        const referralSourceDistribution = Array.from(referralSourceMap.entries())
            .map(([source, count]) => ({
                source,
                count,
                percentage: Math.round((count / totalPlayers) * 100)
            }))
            .sort((a, b) => b.count - a.count);

        // Calculate daily trend data for the past 7 days
        const dailyTrendData = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(now.getDate() - i);
            const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
            
            // Format date as MM-DD with current month
            const currentDate = new Date();
            const isCurrentMonth = date.getMonth() === currentDate.getMonth() && date.getFullYear() === currentDate.getFullYear();
            const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            
            // Count new players for this day
            const newAdditions = allPlayers.filter(player => {
                const createdAt = new Date(player.get('createdAt') as string || player.get('created_at') as string);
                return createdAt >= dayStart && createdAt <= dayEnd;
            }).length;
            
            // Count active players for this day (players with activity on this day)
            const activeUsers = Array.from(statsMap.values()).filter(stats => 
                stats.lastActivity && stats.lastActivity >= dayStart && stats.lastActivity <= dayEnd
            ).length;
            
            dailyTrendData.push({
                date: dateStr,
                newAdditions,
                activeUsers,
                isCurrentMonth
            });
        }

        res.json({
            totalPlayers,
            monthlyNewPlayers,
            todayNewPlayers,
            todayActivePlayers,
            weeklyActivePlayers,
            inactive30DaysPlayers,
            retention1Day,
            retention7Days,
            retention30Days,
            referralSourceDistribution,
            dailyTrendData
        });

    } catch (error) {
        console.error('Error fetching player statistics:', error);
        res.status(500).json({ message: 'Error fetching player statistics' });
    }
};

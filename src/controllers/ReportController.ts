import { Response } from 'express';
import { Op } from 'sequelize';
import sequelize from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { Game, Player, Product, Transaction } from '../models';
import { VendorFactory } from '../services/vendor/VendorFactory';
import { getTenancyScopeOrThrow, withTenancyWhere } from '../tenancy/scope';
import { sendError, sendSuccess } from '../utils/response';

let reportTransactionsSynced = false;
const ensureReportTransactionsSynced = async () => {
  if (reportTransactionsSynced) return;
  try {
    await Transaction.sync({ alter: true });
  } catch {
  }
  reportTransactionsSynced = true;
};

const parseDateParam = (val: string) => {
  let s = val.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    s = s.replace(' ', 'T') + '+08:00';
  }
  return new Date(s);
};

const toFiniteNumber = (v: any): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toYmdInTz8 = (d: Date) => {
  const ms = d.getTime() + 8 * 60 * 60 * 1000;
  const x = new Date(ms);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const toYmdHmInTz8 = (d: Date) => {
  const ms = d.getTime() + 8 * 60 * 60 * 1000;
  const x = new Date(ms);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  const hh = String(x.getUTCHours()).padStart(2, '0');
  const mm = String(x.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
};

const toYmdHmsInTz8 = (d: Date) => {
  const ms = d.getTime() + 8 * 60 * 60 * 1000;
  const x = new Date(ms);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  const hh = String(x.getUTCHours()).padStart(2, '0');
  const mm = String(x.getUTCMinutes()).padStart(2, '0');
  const ss = String(x.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
};

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 24 * 60 * 60 * 1000);

const sumJokerTurnover = async (service: any, start: Date, end: Date, username: string) => {
  let cursor = new Date(start.getTime());
  let total = 0;
  while (cursor.getTime() <= end.getTime()) {
    const chunkEnd = addDays(cursor, 29);
    const effectiveEnd = chunkEnd.getTime() <= end.getTime() ? chunkEnd : end;
    const startYmd = toYmdInTz8(cursor);
    const endYmd = toYmdInTz8(effectiveEnd);
    const resp = await service.getWinloss(startYmd, endYmd, username);
    const list = Array.isArray(resp?.winloss) ? resp.winloss : [];
    for (const item of list) {
      if (String(item?.Username ?? '') === username) {
        total += toFiniteNumber(item?.Amount);
      }
    }
    cursor = addDays(effectiveEnd, 1);
  }
  return total;
};

const toDisplayDateTimeFromIso = (raw: any) => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return toYmdHmsInTz8(d);
};

const resolveVendorServiceForScope = async (scope: any, gameId: number | null, capability: 'winloss' | 'transactions') => {
  if (gameId) {
    return VendorFactory.getServiceByGame(gameId);
  }
  const candidates = await Game.findAll({
    attributes: ['id'],
    where: withTenancyWhere(scope, { use_api: true, status: 'active' } as any),
    limit: 30,
  } as any);
  for (const c of candidates as any[]) {
    const id = Number(c?.id ?? null);
    if (!Number.isFinite(id) || id <= 0) continue;
    const svc = await VendorFactory.getServiceByGame(id);
    if (!svc) continue;
    if (capability === 'winloss' && typeof (svc as any).getWinloss === 'function') return svc;
    if (capability === 'transactions' && typeof (svc as any).getTransactionsByMinute === 'function') return svc;
  }
  return null;
};

const filterRowsByScopePlayers = async (scope: any, rows: any[]) => {
  const usernames = Array.from(
    new Set(
      rows
        .map((r) => (typeof r?.player === 'string' ? r.player.trim() : ''))
        .filter((s) => s.length > 0),
    ),
  );
  if (usernames.length === 0) return rows;

  const allowed = new Set<string>();
  const chunkSize = 800;
  for (let i = 0; i < usernames.length; i += chunkSize) {
    const chunk = usernames.slice(i, i + chunkSize);
    const found = await Player.findAll({
      attributes: ['player_game_id'],
      where: withTenancyWhere(scope, { player_game_id: { [Op.in]: chunk } } as any),
      raw: true,
    } as any);
    for (const f of found as any[]) {
      const u = typeof f?.player_game_id === 'string' ? f.player_game_id.trim() : '';
      if (u) allowed.add(u);
    }
  }

  return rows.filter((r) => {
    const u = typeof r?.player === 'string' ? r.player.trim() : '';
    return u && allowed.has(u);
  });
};

export const getPlayerWinLossReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureReportTransactionsSynced();
    const scope = getTenancyScopeOrThrow(req);
    const { startDate, endDate, gameId, q, page, pageSize } = req.query as any;

    if (!startDate || !endDate) {
      sendError(res, 'Code9004', 400);
      return;
    }

    const start = parseDateParam(String(startDate));
    const end = parseDateParam(String(endDate));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      sendError(res, 'Code9004', 400);
      return;
    }

    const gid = gameId != null && String(gameId).trim().length > 0 ? Number(gameId) : null;
    const normalizedGameId = gid && Number.isFinite(gid) && gid > 0 ? gid : null;

    const pageNum = Math.max(1, Number(page) || 1);
    const pageSizeNum = Math.min(200, Math.max(1, Number(pageSize) || 50));
    const offset = (pageNum - 1) * pageSizeNum;

    const where: any = withTenancyWhere(scope, {
      status: 'COMPLETED',
      player_id: { [Op.ne]: null },
      type: { [Op.in]: ['DEPOSIT', 'WITHDRAWAL'] },
      created_at: { [Op.between]: [start, end] },
    } as any);

    if (normalizedGameId) {
      where.game_id = normalizedGameId;
    }

    const query = typeof q === 'string' ? q.trim() : '';
    if (query) {
      const maybeId = Number(query);
      if (Number.isFinite(maybeId) && maybeId > 0) {
        where.player_id = maybeId;
      } else {
        const candidates = await Player.findAll({
          attributes: ['id'],
          where: withTenancyWhere(scope, {
            player_game_id: { [Op.like]: `%${query}%` },
          } as any),
          limit: 2000,
        } as any);
        const ids = (candidates as any[]).map((p) => Number(p?.id ?? null)).filter((v) => Number.isFinite(v) && v > 0);
        if (ids.length === 0) {
          sendSuccess(res, 'Code1', { rows: [], totalItems: 0, page: pageNum, pageSize: pageSizeNum, game: null });
          return;
        }
        where.player_id = { [Op.in]: ids };
      }
    }

    const depositTotalExpr = `SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END)`;
    const bonusClaimedExpr = `SUM(CASE WHEN type = 'DEPOSIT' THEN bonus ELSE 0 END)`;
    const withdrawalTotalExpr = `SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount ELSE 0 END)`;
    const depCountExpr = `SUM(CASE WHEN type = 'DEPOSIT' THEN 1 ELSE 0 END)`;
    const wdCountExpr = `SUM(CASE WHEN type = 'WITHDRAWAL' THEN 1 ELSE 0 END)`;

    const [totalItemsRaw, grouped] = await Promise.all([
      Transaction.count({
        where,
        distinct: true,
        col: 'player_id',
      } as any),
      Transaction.findAll({
        attributes: [
          'player_id',
          [sequelize.literal(depositTotalExpr), 'total_deposit'],
          [sequelize.literal(bonusClaimedExpr), 'bonus_claimed'],
          [sequelize.literal(withdrawalTotalExpr), 'total_withdrawal'],
          [sequelize.literal(depCountExpr), 'deposit_count'],
          [sequelize.literal(wdCountExpr), 'withdraw_count'],
        ],
        where,
        group: ['player_id'],
        order: [[sequelize.literal('player_id'), 'ASC']],
        limit: pageSizeNum,
        offset,
        raw: true,
      } as any),
    ]);
    const totalItemsNum = Number(totalItemsRaw as any) || 0;

    const totalsRow = (await Transaction.findOne({
      attributes: [
        [sequelize.literal(depositTotalExpr), 'total_deposit'],
        [sequelize.literal(bonusClaimedExpr), 'bonus_claimed'],
        [sequelize.literal(withdrawalTotalExpr), 'total_withdrawal'],
        [sequelize.literal(depCountExpr), 'deposit_count'],
        [sequelize.literal(wdCountExpr), 'withdraw_count'],
      ],
      where,
      raw: true,
    } as any)) as any;

    const playerIds = (grouped as any[])
      .map((r) => Number(r?.player_id ?? null))
      .filter((v) => Number.isFinite(v) && v > 0);

    const players = playerIds.length
      ? await Player.findAll({
          attributes: ['id', 'player_game_id'],
          where: withTenancyWhere(scope, { id: { [Op.in]: playerIds } } as any),
        } as any)
      : [];

    const playerMap = new Map<number, any>();
    for (const p of players as any[]) {
      const id = Number(p?.id ?? null);
      if (!Number.isFinite(id) || id <= 0) continue;
      playerMap.set(id, p);
    }

    const rows = (grouped as any[]).map((r) => {
      const playerId = Number(r?.player_id ?? null);
      const player = playerMap.get(playerId);
      const totalDeposit = toFiniteNumber(r?.total_deposit);
      const bonusClaimed = toFiniteNumber(r?.bonus_claimed);
      const totalWithdrawal = toFiniteNumber(r?.total_withdrawal);
      const totalWinLoss = totalDeposit + bonusClaimed - totalWithdrawal;
      return {
        player_id: playerId,
        player_game_id: player?.player_game_id ?? null,
        deposit_count: Number(r?.deposit_count ?? 0) || 0,
        total_deposit: totalDeposit,
        withdraw_count: Number(r?.withdraw_count ?? 0) || 0,
        total_withdrawal: totalWithdrawal,
        total_winloss: totalWinLoss,
        bonus_claimed: bonusClaimed,
        turnover: 0 as number,
      };
    });

    const totalsTotalDeposit = toFiniteNumber(totalsRow?.total_deposit);
    const totalsBonusClaimed = toFiniteNumber(totalsRow?.bonus_claimed);
    const totalsTotalWithdrawal = toFiniteNumber(totalsRow?.total_withdrawal);
    const totals = {
      deposit_count: Number(totalsRow?.deposit_count ?? 0) || 0,
      total_deposit: totalsTotalDeposit,
      withdraw_count: Number(totalsRow?.withdraw_count ?? 0) || 0,
      total_withdrawal: totalsTotalWithdrawal,
      total_winloss: totalsTotalDeposit + totalsBonusClaimed - totalsTotalWithdrawal,
      bonus_claimed: totalsBonusClaimed,
      turnover: 0 as number,
    };

    let game: any = null;
    let turnoverSupported = false;
    if (normalizedGameId) {
      const g = await Game.findOne({
        attributes: ['id', 'name'],
        where: withTenancyWhere(scope, { id: normalizedGameId } as any),
      } as any);
      if (g) game = { id: (g as any).id, name: (g as any).name };
    }

    const service = await resolveVendorServiceForScope(scope, normalizedGameId, 'winloss');
    if (service && typeof (service as any).getWinloss === 'function') {
      turnoverSupported = true;
      const usernames = rows.map((r) => String(r.player_game_id ?? '')).filter((s) => s.length > 0);
      const turnoverByUsername = new Map<string, number>();
      for (const u of usernames) {
        if (turnoverByUsername.has(u)) continue;
        try {
          const t = await sumJokerTurnover(service as any, start, end, u);
          turnoverByUsername.set(u, t);
        } catch {
          turnoverByUsername.set(u, 0);
        }
      }
      for (const r of rows as any[]) {
        const u = String(r.player_game_id ?? '');
        if (!u) continue;
        r.turnover = turnoverByUsername.get(u) ?? 0;
      }

      const rangeDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      const chunks = Math.max(1, Math.ceil(rangeDays / 30));
      const maxPlayersForGrand = 200;
      const maxApiCalls = 300;
      if (totalItemsNum > 0 && totalItemsNum <= maxPlayersForGrand && totalItemsNum * chunks <= maxApiCalls) {
        const allGrouped = await Transaction.findAll({
          attributes: ['player_id'],
          where,
          group: ['player_id'],
          raw: true,
          limit: totalItemsNum || undefined,
        } as any);
        const allPlayerIds = (allGrouped as any[])
          .map((x) => Number(x?.player_id ?? null))
          .filter((v) => Number.isFinite(v) && v > 0);
        const allPlayers = allPlayerIds.length
          ? await Player.findAll({
              attributes: ['id', 'player_game_id'],
              where: withTenancyWhere(scope, { id: { [Op.in]: allPlayerIds } } as any),
            } as any)
          : [];
        const allUsernames = (allPlayers as any[])
          .map((p) => String(p?.player_game_id ?? '').trim())
          .filter((s) => s.length > 0);
        let grandTurnover = 0;
        const seen = new Set<string>();
        for (const u of allUsernames) {
          if (seen.has(u)) continue;
          seen.add(u);
          try {
            grandTurnover += await sumJokerTurnover(service as any, start, end, u);
          } catch {
          }
        }
        (totals as any).turnover = grandTurnover;
      }
    }

    sendSuccess(res, 'Code1', {
      rows,
      totalItems: totalItemsNum,
      page: pageNum,
      pageSize: pageSizeNum,
      game,
      totals,
      turnoverSupported,
    });
  } catch (err: any) {
    sendError(res, 'Code9000', 500, { detail: err?.original?.sqlMessage ?? err?.message ?? 'Failed to get report' });
  }
};

export const getPlayerGameLogReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    const { startDate, endDate, gameId, username } = req.query as any;

    if (!startDate || !endDate) {
      sendError(res, 'Code9004', 400);
      return;
    }

    const start = parseDateParam(String(startDate));
    const end = parseDateParam(String(endDate));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      sendError(res, 'Code9004', 400);
      return;
    }
    if (end.getTime() <= start.getTime()) {
      sendError(res, 'Code9004', 400);
      return;
    }
    const maxRangeMs = 30 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > maxRangeMs) {
      sendError(res, 'Code9004', 400, { detail: 'player_game_log_range_exceeds_30d' });
      return;
    }

    const gid = gameId != null && String(gameId).trim().length > 0 ? Number(gameId) : null;
    const normalizedGameId = gid && Number.isFinite(gid) && gid > 0 ? gid : null;
    const uname = typeof username === 'string' ? username.trim() : '';

    const mkWindowEnd = (ws: Date) => {
      const ms = ws.getTime() + 24 * 60 * 60 * 1000;
      return new Date(Math.min(ms, end.getTime()));
    };
    const rows: any[] = [];
    let hasMore = false;

    const serviceEntries: Array<{ gameId: number; providerLabel: string; service: any }> = [];
    if (normalizedGameId) {
      const g = await Game.findOne({
        attributes: ['id', 'name', 'product_id'],
        where: withTenancyWhere(scope, { id: normalizedGameId } as any),
      } as any);
      if (!g) {
        sendError(res, 'Code9004', 400);
        return;
      }

      if (uname) {
        const p = await Player.findOne({
          attributes: ['id'],
          where: withTenancyWhere(scope, { player_game_id: uname } as any),
          raw: true,
        } as any);
        if (!p) {
          sendSuccess(res, 'Code1', { username: uname, rows: [], hasMore: false });
          return;
        }
      }

      const service = await resolveVendorServiceForScope(scope, normalizedGameId, 'transactions');
      if (!service || typeof (service as any).getTransactionsByMinute !== 'function') {
        sendError(res, 'Code9004', 400, { detail: 'player_game_log_vendor_not_supported' });
        return;
      }
      const productId = Number((g as any).product_id ?? 0) || 0;
      const product = productId ? await Product.findByPk(productId as any) : null;
      const providerLabel = String((product as any)?.provider ?? (g as any).name ?? 'Vendor');
      serviceEntries.push({ gameId: (g as any).id, providerLabel, service });
    } else {
      const candidates = await Game.findAll({
        attributes: ['id', 'name', 'product_id'],
        where: withTenancyWhere(scope, { use_api: true, status: 'active' } as any),
        limit: 30,
      } as any);
      const maxServices = 10;
      for (const c of candidates as any[]) {
        if (serviceEntries.length >= maxServices) break;
        const id = Number(c?.id ?? null);
        if (!Number.isFinite(id) || id <= 0) continue;
        const service = await resolveVendorServiceForScope(scope, id, 'transactions');
        if (!service || typeof (service as any).getTransactionsByMinute !== 'function') continue;
        const productId = Number(c?.product_id ?? 0) || 0;
        const product = productId ? await Product.findByPk(productId as any) : null;
        const providerLabel = String((product as any)?.provider ?? c?.name ?? 'Vendor');
        serviceEntries.push({ gameId: id, providerLabel, service });
      }
      if (serviceEntries.length === 0) {
        sendSuccess(res, 'Code1', { username: uname || null, rows: [] });
        return;
      }
    }

    const maxPages = 200;
    const maxRows = 200000;
    const maxApiCalls = 1200;
    let apiCalls = 0;
    const seen = new Set<string>();
    for (const entry of serviceEntries) {
      const gameInfoByCode = new Map<string, { name: string; type: string }>();
      let windowStart = new Date(start.getTime());
      while (windowStart.getTime() < end.getTime()) {
        const windowEnd = mkWindowEnd(windowStart);
        const startStr = toYmdHmInTz8(windowStart);
        const endStr = toYmdHmInTz8(windowEnd);

        let nextId = '';
        let pages = 0;
        while (pages < maxPages) {
          apiCalls += 1;
          if (apiCalls > maxApiCalls) {
            hasMore = true;
            break;
          }
          const resp = await (entry.service as any).getTransactionsByMinute(startStr, endStr, { nextId });
        if (!resp?.success) {
          sendError(res, 'Code9000', 500, { detail: resp?.error || resp?.message || 'Failed to get vendor transactions' });
          return;
        }

        const gamesArr = Array.isArray(resp?.games) ? resp.games : [];
        for (const g of gamesArr) {
          const code = String(g?.GameCode ?? '').trim();
          if (!code) continue;
          const name = String(g?.GameName ?? '').trim();
          const type = String(g?.GameType ?? '').trim();
          gameInfoByCode.set(code, { name, type });
        }

        const data = resp?.data && typeof resp.data === 'object' ? resp.data : {};
        for (const key of Object.keys(data)) {
          const arr = (data as any)[key];
          if (!Array.isArray(arr)) continue;
          for (const tx of arr) {
            const txUsername = String(tx?.Username ?? '').trim();
            if (!txUsername) continue;
            if (uname && txUsername !== uname) continue;
            const ocode = String(tx?.OCode ?? '').trim();
            const txKey = ocode ? `${entry.gameId}:${ocode}` : '';
            if (txKey && seen.has(txKey)) continue;
            const gameCode = String(tx?.GameCode ?? '').trim();
            const info = gameInfoByCode.get(gameCode);
            const bet = toFiniteNumber(tx?.Amount);
            const resultAmount = toFiniteNumber(tx?.Result);
            rows.push({
              player: txUsername,
              start_time: toDisplayDateTimeFromIso(tx?.Time),
              end_time: toDisplayDateTimeFromIso(tx?.Time),
              game_id: entry.gameId,
              ocode: ocode || null,
              game_provider: entry.providerLabel,
              game_name: info?.name || null,
              game_category: info?.type || null,
              start_balance: toFiniteNumber(tx?.StartBalance),
              end_balance: toFiniteNumber(tx?.EndBalance),
              bet,
              win_lose: resultAmount - bet,
            });
            if (txKey) seen.add(txKey);
            if (rows.length >= maxRows) {
              hasMore = true;
              break;
            }
          }
          if (rows.length >= maxRows) break;
        }
        if (rows.length >= maxRows) break;

          const nextRaw = resp?.nextId;
          nextId = nextRaw ? String(nextRaw) : '';
          pages += 1;
          if (!nextId) break;
        }
        if (nextId) hasMore = true;
        if (rows.length >= maxRows || apiCalls > maxApiCalls) break;

        windowStart = windowEnd;
      }
      if (rows.length >= maxRows || apiCalls > maxApiCalls) break;
    }

    const filteredRows = uname ? rows : await filterRowsByScopePlayers(scope, rows);
    if (!uname && filteredRows.length < rows.length) {
      hasMore = hasMore || rows.length > filteredRows.length;
    }

    filteredRows.sort((a, b) => String(b?.start_time ?? '').localeCompare(String(a?.start_time ?? '')));

    sendSuccess(res, 'Code1', {
      username: uname || null,
      rows: filteredRows,
      hasMore,
    });
  } catch (err: any) {
    sendError(res, 'Code9000', 500, { detail: err?.original?.sqlMessage ?? err?.message ?? 'Failed to get report' });
  }
};

export const getPlayerGameLogHistoryUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    const { gameId, ocode, language } = req.query as any;
    const o = typeof ocode === 'string' ? ocode.trim() : '';
    if (!o) {
      sendError(res, 'Code9004', 400);
      return;
    }

    const gid = gameId != null && String(gameId).trim().length > 0 ? Number(gameId) : null;
    const normalizedGameId = gid && Number.isFinite(gid) && gid > 0 ? gid : null;
    const svc = await resolveVendorServiceForScope(scope, normalizedGameId, 'transactions');
    if (!svc || typeof (svc as any).getHistoryUrl !== 'function') {
      sendError(res, 'Code9004', 400, { detail: 'player_game_log_vendor_not_supported' });
      return;
    }

    const lang = typeof language === 'string' && language.trim().length > 0 ? language.trim() : 'en';
    const resp = await (svc as any).getHistoryUrl(o, lang);
    if (!resp?.success) {
      sendError(res, 'Code9000', 500, { detail: resp?.error || resp?.message || 'Failed to get history url' });
      return;
    }
    sendSuccess(res, 'Code1', { url: resp?.url ?? null });
  } catch (err: any) {
    sendError(res, 'Code9000', 500, { detail: err?.original?.sqlMessage ?? err?.message ?? 'Failed to get history url' });
  }
};

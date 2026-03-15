import { Response } from 'express';
import { Op } from 'sequelize';
import sequelize from '../config/database';
import { LandingPage, LandingPageEvent, LandingPageVisit, Setting, User } from '../models';
import { AuthRequest } from '../middleware/auth';
import { decrypt, isEncrypted } from '../utils/encryption';

const tryDecryptIp = (cipher: any): string | null => {
  if (typeof cipher !== 'string') return null;
  const raw = cipher.trim();
  if (!raw) return null;
  if (!isEncrypted(raw)) return raw;
  try {
    const dec = decrypt(raw);
    return typeof dec === 'string' && dec.trim().length > 0 ? dec : null;
  } catch {
    return null;
  }
};

const toCount = (value: any): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const titleWords = (value: any): string => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return 'Unknown';
  return s
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
};

const formatOsLabel = (value: any): string => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return 'Unknown';
  if (raw === 'ios') return 'iOS';
  if (raw === 'android') return 'Android';
  if (raw === 'windows') return 'Windows';
  if (raw === 'linux') return 'Linux';
  if (raw === 'macos' || raw === 'mac os' || raw === 'mac os x') return 'Mac OS X';
  if (raw === 'other') return 'Other';
  return titleWords(raw);
};

const formatBrowserLabel = (value: any): string => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return 'Unknown';
  const map: Record<string, string> = {
    'chrome mobile webview': 'Chrome Mobile WebView',
    'chrome mobile': 'Chrome Mobile',
    'chrome': 'Chrome',
    'firefox mobile': 'Firefox Mobile',
    'firefox': 'Firefox',
    'mobile safari': 'Mobile Safari',
    'safari': 'Safari',
    'edge': 'Edge',
    'facebook': 'Facebook',
  };
  return map[raw] || titleWords(raw);
};

const formatDeviceLabel = (value: any): string => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return 'Unknown';
  if (raw === 'mobile') return 'Mobile';
  if (raw === 'desktop') return 'Desktop';
  if (raw === 'tablet') return 'Tablet';
  if (raw === 'other') return 'Other';
  return titleWords(raw);
};

const formatLanguageTag = (value: any): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'Unknown';
  const lower = raw.toLowerCase();
  const parts = lower.split('-').filter(Boolean);
  if (parts.length === 0) return 'Unknown';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}-${parts[1].toUpperCase()}`;
};

const extractReferrerHost = (origin: any): string | null => {
  if (typeof origin !== 'string') return null;
  const v = origin.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
};

const referrerDisplay = (origin: any): string => {
  const host = extractReferrerHost(origin);
  if (!host) return 'direct';
  if (host === 'l.facebook.com' || host.endsWith('facebook.com') || host === 'fb.com') return 'facebook';
  if (host.endsWith('instagram.com')) return 'instagram';
  if (host.endsWith('tiktok.com') || host === 'vm.tiktok.com') return 'tiktok';
  if (host.endsWith('google.com') || host.endsWith('google.com.hk') || host.endsWith('google.com.tw') || host.endsWith('google.co') || host.endsWith('google.co.uk') || host.endsWith('google.co.jp')) return 'google';
  if (host.endsWith('bing.com')) return 'bing';
  if (host.endsWith('yahoo.com')) return 'yahoo';
  if (host === 't.me' || host === 'telegram.me' || host.endsWith('telegram.org')) return 'telegram';
  if (host === 't.co' || host.endsWith('twitter.com') || host.endsWith('x.com')) return 'twitter';
  return host;
};

const isValidHttpUrl = (value: string): boolean => {
  const v = value.trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
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

const normalizeSource = (value: any): string => {
  const s = typeof value === 'string' ? value.trim() : '';
  return s;
};

const parseSourceOptions = (raw: any): string[] => {
  const fromArray = (arr: any[]): string[] => arr.map(normalizeSource).filter(Boolean);

  if (Array.isArray(raw)) return fromArray(raw);

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return fromArray(parsed);
      if (typeof parsed === 'string') return fromArray([parsed]);
    } catch {
    }
    return trimmed
      .split(/[\n,;]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (raw && typeof raw === 'object') {
    const maybeOptions = (raw as any).options;
    if (Array.isArray(maybeOptions)) return fromArray(maybeOptions);
    const allValues = Object.values(raw);
    const flattened: any[] = [];
    for (const v of allValues) {
      if (Array.isArray(v)) flattened.push(...v);
    }
    if (flattened.length > 0) return fromArray(flattened);
  }

  return [];
};

export const listLandingPages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const qRaw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
    const sourceRaw = typeof req.query.source === 'string' ? req.query.source.trim() : '';
    const pageRaw = typeof req.query.page === 'string' ? req.query.page : '1';
    const pageSizeRaw = typeof req.query.pageSize === 'string' ? req.query.pageSize : '50';

    const page = Math.max(1, parseInt(pageRaw, 10) || 1);
    const pageSizeBase = parseInt(pageSizeRaw, 10);
    const pageSize = Number.isNaN(pageSizeBase) || pageSizeBase <= 0 ? 50 : Math.min(pageSizeBase, 200);
    const offset = (page - 1) * pageSize;

    const where: any = {};
    if (qRaw) {
      const like = `%${qRaw}%`;
      where[Op.or] = [{ name: { [Op.like]: like } }, { page_url: { [Op.like]: like } }];
    }
    if (statusRaw === 'active' || statusRaw === 'inactive') {
      where.status = statusRaw;
    }
    if (sourceRaw) {
      where.source = sourceRaw;
    }

    const [result, sourceSetting] = await Promise.all([
      LandingPage.findAndCountAll({
        where,
        include: [{ model: User, as: 'operator', attributes: ['id', 'username', 'full_name'] }],
        order: [['updated_at', 'DESC']],
        limit: pageSize,
        offset,
      }),
      Setting.findByPk('referralSources'),
    ]);

    const items = result.rows.map((row: any) => {
      const json = row.toJSON();
      const operatorName = resolveOperatorName(json.operator);
      return {
        id: json.id,
        name: json.name,
        page_url: json.page_url,
        source: json.source ?? null,
        status: json.status,
        operator: json.operator ? { id: json.operator.id, name: operatorName } : null,
        created_at: json.created_at,
        updated_at: json.updated_at,
      };
    });

    const rawSourceOptions = (sourceSetting as any)?.value;
    let sourceOptions = parseSourceOptions(rawSourceOptions);
    if (sourceOptions.length === 0) {
      try {
        const [rows] = await sequelize.query(
          "SELECT DISTINCT source FROM landing_pages WHERE source IS NOT NULL AND TRIM(source) <> '' ORDER BY source ASC"
        );
        const dbSources = Array.isArray(rows) ? rows.map((r: any) => normalizeSource(r?.source)).filter(Boolean) : [];
        sourceOptions = dbSources;
      } catch {
      }
    }
    sourceOptions = Array.from(new Set(sourceOptions)).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    res.json({ items, total: result.count, page, pageSize, sourceOptions });
  } catch {
    res.status(500).json({ message: 'LP101' });
  }
};

export const getLandingPage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'LP104' });
      return;
    }

    const page = await LandingPage.findByPk(id);
    if (!page) {
      res.status(404).json({ message: 'LP105' });
      return;
    }

    const json: any = (page as any).toJSON ? (page as any).toJSON() : (page as any);
    res.json({
      id: json.id,
      name: json.name,
      page_url: json.page_url,
      source: json.source ?? null,
      status: json.status,
      title: json.title ?? null,
      subtitle: json.subtitle ?? null,
      hero_image_url: json.hero_image_url ?? null,
      primary_cta_text: json.primary_cta_text ?? null,
      primary_cta_url: json.primary_cta_url ?? null,
      secondary_cta_text: json.secondary_cta_text ?? null,
      secondary_cta_url: json.secondary_cta_url ?? null,
      created_at: json.created_at,
      updated_at: json.updated_at,
    });
  } catch {
    res.status(500).json({ message: 'LP110' });
  }
};

export const createLandingPage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const pageUrl = typeof req.body?.page_url === 'string' ? req.body.page_url.trim() : '';
    const source = typeof req.body?.source === 'string' ? req.body.source.trim() : null;
    const statusRaw = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : 'active';
    const status = statusRaw === 'inactive' ? 'inactive' : 'active';
    const themeRaw = typeof req.body?.theme === 'string' ? req.body.theme.trim().toLowerCase() : 'auto';
    const theme = themeRaw === 'light' || themeRaw === 'dark' || themeRaw === 'auto' ? themeRaw : 'auto';

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : null;
    const subtitle = typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim() : null;
    const hero_image_url = typeof req.body?.hero_image_url === 'string' ? req.body.hero_image_url.trim() : null;
    const primary_cta_text = typeof req.body?.primary_cta_text === 'string' ? req.body.primary_cta_text.trim() : null;
    const primary_cta_url = typeof req.body?.primary_cta_url === 'string' ? req.body.primary_cta_url.trim() : null;
    const secondary_cta_text = typeof req.body?.secondary_cta_text === 'string' ? req.body.secondary_cta_text.trim() : null;
    const secondary_cta_url = typeof req.body?.secondary_cta_url === 'string' ? req.body.secondary_cta_url.trim() : null;

    if (!name || !pageUrl) {
      res.status(400).json({ message: 'LP102' });
      return;
    }

    if (!isValidHttpUrl(pageUrl)) {
      res.status(400).json({ message: 'LP109' });
      return;
    }

    const operatorId = req.user?.id ? Number(req.user.id) : null;

    const created = await LandingPage.create({
      name,
      page_url: pageUrl,
      source,
      status,
      operator_id: operatorId,
      theme,
      title: title && title.length > 0 ? title.slice(0, 120) : null,
      subtitle: subtitle && subtitle.length > 0 ? subtitle.slice(0, 240) : null,
      hero_image_url: hero_image_url && hero_image_url.length > 0 ? hero_image_url.slice(0, 2048) : null,
      primary_cta_text: primary_cta_text && primary_cta_text.length > 0 ? primary_cta_text.slice(0, 60) : null,
      primary_cta_url: primary_cta_url && primary_cta_url.length > 0 ? primary_cta_url.slice(0, 2048) : null,
      secondary_cta_text: secondary_cta_text && secondary_cta_text.length > 0 ? secondary_cta_text.slice(0, 60) : null,
      secondary_cta_url: secondary_cta_url && secondary_cta_url.length > 0 ? secondary_cta_url.slice(0, 2048) : null,
    } as any);

    res.json(created);
  } catch {
    res.status(500).json({ message: 'LP103' });
  }
};

export const updateLandingPage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'LP104' });
      return;
    }

    const page = await LandingPage.findByPk(id);
    if (!page) {
      res.status(404).json({ message: 'LP105' });
      return;
    }

    if (typeof req.body?.name === 'string') {
      page.name = req.body.name.trim();
    }
    if (typeof req.body?.page_url === 'string') {
      const next = req.body.page_url.trim();
      if (!isValidHttpUrl(next)) {
        res.status(400).json({ message: 'LP109' });
        return;
      }
      page.page_url = next;
    }
    if (typeof req.body?.source === 'string') {
      const next = req.body.source.trim();
      page.source = next.length > 0 ? next : null;
    }
    if (typeof req.body?.status === 'string') {
      const raw = req.body.status.trim().toLowerCase();
      if (raw === 'active' || raw === 'inactive') {
        page.status = raw as any;
      }
    }

    if (typeof req.body?.theme === 'string') {
      const raw = req.body.theme.trim().toLowerCase();
      if (raw === 'light' || raw === 'dark' || raw === 'auto') {
        (page as any).theme = raw;
      }
    }
    if (typeof req.body?.title === 'string') {
      const next = req.body.title.trim();
      (page as any).title = next.length > 0 ? next.slice(0, 120) : null;
    }
    if (typeof req.body?.subtitle === 'string') {
      const next = req.body.subtitle.trim();
      (page as any).subtitle = next.length > 0 ? next.slice(0, 240) : null;
    }
    if (typeof req.body?.hero_image_url === 'string') {
      const next = req.body.hero_image_url.trim();
      (page as any).hero_image_url = next.length > 0 ? next.slice(0, 2048) : null;
    }
    if (typeof req.body?.primary_cta_text === 'string') {
      const next = req.body.primary_cta_text.trim();
      (page as any).primary_cta_text = next.length > 0 ? next.slice(0, 60) : null;
    }
    if (typeof req.body?.primary_cta_url === 'string') {
      const next = req.body.primary_cta_url.trim();
      (page as any).primary_cta_url = next.length > 0 ? next.slice(0, 2048) : null;
    }
    if (typeof req.body?.secondary_cta_text === 'string') {
      const next = req.body.secondary_cta_text.trim();
      (page as any).secondary_cta_text = next.length > 0 ? next.slice(0, 60) : null;
    }
    if (typeof req.body?.secondary_cta_url === 'string') {
      const next = req.body.secondary_cta_url.trim();
      (page as any).secondary_cta_url = next.length > 0 ? next.slice(0, 2048) : null;
    }

    const operatorId = req.user?.id ? Number(req.user.id) : null;
    page.operator_id = operatorId;

    await page.save();
    res.json(page);
  } catch {
    res.status(500).json({ message: 'LP106' });
  }
};

export const deleteLandingPage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'LP107' });
      return;
    }

    const page = await LandingPage.findByPk(id);
    if (!page) {
      res.status(404).json({ message: 'LP105' });
      return;
    }

    await sequelize.transaction(async (t) => {
      await LandingPageVisit.destroy({ where: { landing_page_id: id }, transaction: t } as any);
      await LandingPageEvent.destroy({ where: { landing_page_id: id }, transaction: t } as any);
      await page.destroy({ transaction: t } as any);
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: 'LP108' });
  }
};

export const getLandingAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'LP104' });
      return;
    }

    const startRaw = typeof req.query.start === 'string' ? req.query.start : '';
    const endRaw = typeof req.query.end === 'string' ? req.query.end : '';

    const start = startRaw ? new Date(startRaw) : null;
    const end = endRaw ? new Date(endRaw) : null;

    const whereRange: any = { landing_page_id: id };
    const whereEventRange: any = { landing_page_id: id };
    if (start && !Number.isNaN(start.getTime())) {
      whereRange.created_at = { ...(whereRange.created_at || {}), [Op.gte]: start };
      whereEventRange.created_at = { ...(whereEventRange.created_at || {}), [Op.gte]: start };
    }
    if (end && !Number.isNaN(end.getTime())) {
      whereRange.created_at = { ...(whereRange.created_at || {}), [Op.lte]: end };
      whereEventRange.created_at = { ...(whereEventRange.created_at || {}), [Op.lte]: end };
    }

    const pvPromise = LandingPageVisit.count({ where: whereRange });
    const uvPromise = LandingPageVisit.count({
      where: whereRange,
      distinct: true,
      col: 'ip_hash',
    } as any);
    const clickPromise = LandingPageEvent.count({
      where: { ...whereEventRange, event_name: { [Op.like]: 'click_%' } },
    } as any);

    const byOsPromise = LandingPageVisit.findAll({
      attributes: [[sequelize.fn('LOWER', sequelize.col('os')), 'os'], [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: whereRange,
      group: [sequelize.fn('LOWER', sequelize.col('os'))],
      order: [[sequelize.literal('count'), 'DESC']],
      limit: 20,
      raw: true,
    } as any);

    const byRefPromise = LandingPageVisit.findAll({
      attributes: ['referrer_origin', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: whereRange,
      group: ['referrer_origin'],
      order: [[sequelize.literal('count'), 'DESC']],
      limit: 20,
      raw: true,
    } as any);

    const byBrowserPromise = LandingPageVisit.findAll({
      attributes: [[sequelize.fn('LOWER', sequelize.col('browser')), 'browser'], [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: whereRange,
      group: [sequelize.fn('LOWER', sequelize.col('browser'))],
      order: [[sequelize.literal('count'), 'DESC']],
      limit: 20,
      raw: true,
    } as any);

    const byDevicePromise = LandingPageVisit.findAll({
      attributes: ['device_type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: whereRange,
      group: ['device_type'],
      order: [[sequelize.literal('count'), 'DESC']],
      limit: 20,
      raw: true,
    } as any);

    const byLanguagePromise = LandingPageVisit.findAll({
      attributes: [[sequelize.fn('LOWER', sequelize.col('language')), 'language'], [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: whereRange,
      group: [sequelize.fn('LOWER', sequelize.col('language'))],
      order: [[sequelize.literal('count'), 'DESC']],
      limit: 20,
      raw: true,
    } as any);

    const clicksByEventPromise = LandingPageEvent.findAll({
      attributes: ['event_name', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: { ...whereEventRange, event_name: { [Op.like]: 'click_%' } },
      group: ['event_name'],
      order: [[sequelize.literal('count'), 'DESC']],
      limit: 20,
      raw: true,
    } as any);

    const [pv, uv, clicks, byOs, byRef, byBrowser, byDevice, byLanguage, clicksByEvent] = await Promise.all([
      pvPromise,
      uvPromise,
      clickPromise,
      byOsPromise,
      byRefPromise,
      byBrowserPromise,
      byDevicePromise,
      byLanguagePromise,
      clicksByEventPromise,
    ]);

    const byReferrerHostMap = new Map<string, number>();
    (byRef as any[]).forEach((row: any) => {
      const key = referrerDisplay(row.referrer_origin);
      byReferrerHostMap.set(key, (byReferrerHostMap.get(key) || 0) + toCount(row.count));
    });
    const byReferrer = Array.from(byReferrerHostMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([referrer, count]) => ({ referrer, count }));

    res.json({
      pv,
      uv,
      clicks,
      byOs: (byOs as any[]).map((r: any) => ({ os: formatOsLabel(r.os), count: toCount(r.count) })),
      byReferrer,
      byBrowser: (byBrowser as any[]).map((r: any) => ({ browser: formatBrowserLabel(r.browser), count: toCount(r.count) })),
      byDeviceType: (byDevice as any[]).map((r: any) => ({ device_type: formatDeviceLabel(r.device_type), count: toCount(r.count) })),
      byLanguage: (byLanguage as any[]).map((r: any) => ({ language: formatLanguageTag(r.language), count: toCount(r.count) })),
      clicksByEvent: (clicksByEvent as any[]).map((r: any) => ({ event_name: r.event_name, count: toCount(r.count) })),
    });
  } catch {
    res.status(500).json({ message: 'LP201' });
  }
};

export const getLandingVisitDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'LP104' });
      return;
    }

    const startRaw = typeof req.query.start === 'string' ? req.query.start : '';
    const endRaw = typeof req.query.end === 'string' ? req.query.end : '';

    const limitRaw = typeof req.query.limit === 'string' ? req.query.limit : '100';
    const offsetRaw = typeof req.query.offset === 'string' ? req.query.offset : '0';
    const limitBase = parseInt(limitRaw, 10);
    const offsetBase = parseInt(offsetRaw, 10);
    const limit = Number.isNaN(limitBase) || limitBase <= 0 ? 100 : Math.min(limitBase, 1000);
    const offset = Number.isNaN(offsetBase) || offsetBase < 0 ? 0 : offsetBase;

    const start = startRaw ? new Date(startRaw) : null;
    const end = endRaw ? new Date(endRaw) : null;

    const where: any = { landing_page_id: id };
    if (start && !Number.isNaN(start.getTime())) {
      where.created_at = { ...(where.created_at || {}), [Op.gte]: start };
    }
    if (end && !Number.isNaN(end.getTime())) {
      where.created_at = { ...(where.created_at || {}), [Op.lte]: end };
    }

    const { rows, count } = await LandingPageVisit.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    const items = rows.map((r: any) => {
      const json = r.toJSON();
      const ipPlain = tryDecryptIp(json.ip_enc);
      return {
        id: json.id,
        created_at: json.created_at,
        ip: ipPlain,
        referrer_origin: json.referrer_origin ?? null,
        referrer_path: json.referrer_path ?? null,
        page_url: json.page_url ?? null,
        os: json.os ?? null,
        browser: json.browser ?? null,
        device_type: json.device_type ?? null,
        language: json.language ?? null,
        timezone_offset: json.timezone_offset ?? null,
        screen: json.screen ?? null,
        session_id: json.session_id ?? null,
        is_bot: Boolean(json.is_bot),
        suspected_bot: Boolean(json.suspected_bot),
      };
    });

    res.json({ total: count, limit, offset, items });
  } catch {
    res.status(500).json({ message: 'LP301' });
  }
};

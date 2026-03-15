import { Request, Response } from 'express';
import crypto from 'crypto';
import { UAParser } from 'ua-parser-js';
import { LandingPageEvent, LandingPageVisit } from '../models';
import { encrypt, isEncrypted } from '../utils/encryption';

const GIF_1X1_BASE64 = 'R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const GIF_1X1_BUFFER = Buffer.from(GIF_1X1_BASE64, 'base64');

const getClientIp = (req: Request): string => {
  const ip = (req as any).ip;
  if (typeof ip === 'string' && ip.trim().length > 0) return ip.trim();
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.trim().length > 0) return xfwd.split(',')[0].trim();
  return '';
};

const hmacIp = (ip: string): string => {
  const secret = (process.env.LANDING_IP_HASH_SECRET || process.env.JWT_SECRET || '').trim();
  const key = secret.length > 0 ? secret : 'landing_ip_hash_fallback_secret';
  return crypto.createHmac('sha256', key).update(ip).digest('hex');
};

const shouldStoreIpEnc = (): boolean => {
  const raw = (process.env.LANDING_STORE_IP_ENC || '').trim().toLowerCase();
  if (!raw) return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return true;
};

const safeInt = (value: any, min: number, max: number): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < min || i > max) return null;
  return i;
};

const safeLang = (value: any): string | null => {
  if (typeof value !== 'string') return null;
  const primary = value.split(',')[0]?.split(';')[0] || '';
  const v = primary.trim().replace(/_/g, '-').toLowerCase();
  if (!v) return null;
  const safe = v.replace(/[^a-z0-9-]/g, '').slice(0, 16);
  return safe.length > 0 ? safe : null;
};

const safeScreen = (value: any): string | null => {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const safe = v.replace(/[^0-9x]/g, '').slice(0, 32);
  return safe.length > 0 ? safe : null;
};

const parseUa = (ua: string) => {
  const parser = new UAParser(ua);
  const os = parser.getOS();
  const browser = parser.getBrowser();
  const device = parser.getDevice();

  let osLabel: string | null = os?.name ? String(os.name) : null;
  if (osLabel === 'Mac OS') osLabel = 'Mac OS X';

  const deviceTypeRaw = device?.type ? String(device.type) : '';
  const isMobileLike = deviceTypeRaw === 'mobile';
  const isTabletLike = deviceTypeRaw === 'tablet';
  const isDesktopLike = !deviceTypeRaw && (osLabel === 'Windows' || osLabel === 'Mac OS X' || osLabel === 'Linux');

  const deviceType: 'mobile' | 'desktop' | 'tablet' | 'other' =
    isMobileLike ? 'mobile' : isTabletLike ? 'tablet' : isDesktopLike ? 'desktop' : deviceTypeRaw ? 'other' : 'other';

  let browserLabel: string | null = browser?.name ? String(browser.name) : null;
  const uaLower = ua.toLowerCase();

  if (browserLabel === 'Chrome' && deviceType === 'mobile') {
    browserLabel = uaLower.includes(' wv') || uaLower.includes('; wv') ? 'Chrome Mobile WebView' : 'Chrome Mobile';
  } else if (browserLabel === 'Firefox' && deviceType === 'mobile') {
    browserLabel = 'Firefox Mobile';
  } else if (browserLabel === 'Safari' && deviceType === 'mobile') {
    browserLabel = 'Mobile Safari';
  }

  return { osLabel, browserLabel, deviceType };
};

const isBotUa = (ua: string): boolean => {
  const s = ua.toLowerCase();
  if (!s) return true;
  const markers = [
    'bot',
    'spider',
    'crawler',
    'facebookexternalhit',
    'facebookbot',
    'bytespider',
    'python-requests',
    'curl/',
    'wget',
    'headless',
  ];
  return markers.some((m) => s.includes(m));
};

const safeUrlParts = (raw: string | null): { origin: string | null; path: string | null } => {
  if (!raw) return { origin: null, path: null };
  try {
    const u = new URL(raw);
    return { origin: u.origin, path: u.pathname };
  } catch {
    return { origin: null, path: null };
  }
};

const safeShortText = (value: any, maxLen: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
};

const sendGif = (res: Response) => {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send(GIF_1X1_BUFFER);
};

export const trackLandingPageViewGif = async (req: Request, res: Response) => {
  const landingPageId = Number(req.query.lp);
  if (Number.isNaN(landingPageId)) {
    return sendGif(res);
  }

  const ua = safeShortText(req.headers['user-agent'], 512) || '';
  const uaInfo = parseUa(ua);
  const ip = getClientIp(req);
  const ipHash = hmacIp(ip || '');

  const pageUrl = safeShortText(req.query.u, 2048);
  const refRaw = safeShortText(req.query.r, 2048);
  const refParts = safeUrlParts(refRaw);

  const sessionId = safeShortText(req.query.sid, 64);

  const ipEnc =
    shouldStoreIpEnc() && ip
      ? isEncrypted(ip)
        ? ip
        : encrypt(ip)
      : null;

  const record = {
    landing_page_id: landingPageId,
    session_id: sessionId,
    ip_hash: ipHash,
    ip_enc: ipEnc,
    page_url: pageUrl,
    referrer_origin: refParts.origin,
    referrer_path: refParts.path,
    utm_source: safeShortText(req.query.utm_source, 255),
    utm_campaign: safeShortText(req.query.utm_campaign, 255),
    utm_medium: safeShortText(req.query.utm_medium, 255),
    utm_content: safeShortText(req.query.utm_content, 255),
    utm_term: safeShortText(req.query.utm_term, 255),
    fbclid: safeShortText(req.query.fbclid, 255),
    os: uaInfo.osLabel,
    browser: uaInfo.browserLabel,
    user_agent: ua || null,
    is_bot: isBotUa(ua),
    suspected_bot: false,
    device_type: uaInfo.deviceType,
    language: safeLang(req.query.lang || req.headers['accept-language']),
    timezone_offset: safeInt(req.query.tz, -900, 900),
    screen: safeScreen(req.query.sc),
  };

  try {
    void LandingPageVisit.create(record as any);
  } catch {}

  return sendGif(res);
};

export const trackLandingEventGif = async (req: Request, res: Response) => {
  const landingPageId = Number(req.query.lp);
  if (Number.isNaN(landingPageId)) {
    return sendGif(res);
  }

  const ua = safeShortText(req.headers['user-agent'], 512) || '';
  const uaInfo = parseUa(ua);
  const ip = getClientIp(req);
  const ipHash = hmacIp(ip || '');

  const sessionId = safeShortText(req.query.sid, 64);
  const eventName = safeShortText(req.query.ev, 64) || 'event';
  const elementId = safeShortText(req.query.el, 64);

  const ipEnc =
    shouldStoreIpEnc() && ip
      ? isEncrypted(ip)
        ? ip
        : encrypt(ip)
      : null;

  const meta = {
    u: safeShortText(req.query.u, 2048),
    r: safeShortText(req.query.r, 2048),
    utm_source: safeShortText(req.query.utm_source, 255),
    utm_campaign: safeShortText(req.query.utm_campaign, 255),
    utm_medium: safeShortText(req.query.utm_medium, 255),
    utm_content: safeShortText(req.query.utm_content, 255),
    utm_term: safeShortText(req.query.utm_term, 255),
    fbclid: safeShortText(req.query.fbclid, 255),
    tz: safeInt(req.query.tz, -900, 900),
    lang: safeLang(req.query.lang || req.headers['accept-language']),
    sc: safeScreen(req.query.sc),
  };

  const record = {
    landing_page_id: landingPageId,
    event_name: eventName,
    element_id: elementId,
    session_id: sessionId,
    ip_hash: ipHash,
    ip_enc: ipEnc,
    meta,
    os: uaInfo.osLabel,
    browser: uaInfo.browserLabel,
    user_agent: ua || null,
    is_bot: isBotUa(ua),
    suspected_bot: false,
    device_type: uaInfo.deviceType,
    language: safeLang(req.query.lang || req.headers['accept-language']),
    timezone_offset: safeInt(req.query.tz, -900, 900),
    screen: safeScreen(req.query.sc),
  };

  try {
    void LandingPageEvent.create(record as any);
  } catch {}

  return sendGif(res);
};

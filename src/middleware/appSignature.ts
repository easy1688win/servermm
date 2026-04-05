import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import dotenv from "dotenv";
import { getCache, setCache } from "../services/CacheService";
import { sendError } from "../utils/response";

dotenv.config();

const WINDOW_MS = 5 * 60 * 1000;

const getHeader = (req: Request, key: string): string | null => {
  const v = req.headers[key.toLowerCase()];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
};

const parseTimestampMs = (raw: string | null): number | null => {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n > 1e12) return Math.trunc(n);
  return Math.trunc(n * 1000);
};

const sha256Hex = (buf: Buffer): string =>
  crypto.createHash("sha256").update(buf).digest("hex");

const hmacHex = (secret: string, msg: string): string =>
  crypto.createHmac("sha256", secret).update(msg).digest("hex");

const safeEqualHex = (a: string, b: string): boolean => {
  const ab = Buffer.from(String(a || ""), "hex");
  const bb = Buffer.from(String(b || ""), "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
};

const getAppSecretByKey = (key: string): string | null => {
  const mapRaw = (process.env.APP_HMAC_KEYS || "").trim();
  if (mapRaw) {
    try {
      const parsed = JSON.parse(mapRaw) as Record<string, string>;
      const secret = parsed?.[key];
      return typeof secret === "string" && secret.length > 0 ? secret : null;
    } catch {
      return null;
    }
  }
  const singleKey = (process.env.APP_API_KEY || "").trim();
  const singleSecret = (process.env.APP_API_SECRET || "").trim();
  if (singleKey && singleSecret && singleKey === key) return singleSecret;
  return null;
};

export const requireAppSignature = (req: Request, res: Response, next: NextFunction) => {
  const enabled = String(process.env.APP_HMAC_ENABLED || "").trim().toLowerCase() === "true";
  if (!enabled) return next();

  const required = String(process.env.APP_HMAC_REQUIRED || "").trim().toLowerCase() === "true";
  const hasSigHeader =
    Boolean(getHeader(req, "x-api-signature")) ||
    Boolean(getHeader(req, "x-sig")) ||
    Boolean(getHeader(req, "x-api-key")) ||
    Boolean(getHeader(req, "x-ak"));

  const isAuthRoute = req.path.startsWith("/auth/");

  if (!required || isAuthRoute) return next();
  if (!hasSigHeader) {
    sendError(res, "Code121", 401);
    return;
  }

  const apiKey = getHeader(req, "x-api-key") || getHeader(req, "x-ak");
  const tsRaw = getHeader(req, "x-api-timestamp") || getHeader(req, "x-ts");
  const sig = getHeader(req, "x-api-signature") || getHeader(req, "x-sig");
  const nonce = getHeader(req, "x-api-nonce") || getHeader(req, "x-nonce");

  if (!apiKey || !tsRaw || !sig) {
    sendError(res, "Code121", 401);
    return;
  }

  const tsMs = parseTimestampMs(tsRaw);
  if (!tsMs) {
    sendError(res, "Code119", 401);
    return;
  }

  const now = Date.now();
  if (Math.abs(now - tsMs) > WINDOW_MS) {
    sendError(res, "Code119", 401);
    return;
  }

  const secret = getAppSecretByKey(apiKey);
  if (!secret) {
    sendError(res, "Code118", 403);
    return;
  }

  const rawBody: Buffer = Buffer.isBuffer((req as any).rawBody) ? (req as any).rawBody : Buffer.from("");
  const bodyHash = sha256Hex(rawBody);
  const path = req.originalUrl;
  const base = `${req.method.toUpperCase()}\n${path}\n${String(Math.trunc(tsMs))}\n${bodyHash}`;
  const message = nonce ? `${base}\n${nonce}` : base;
  const expected = hmacHex(secret, message);

  if (!safeEqualHex(expected, sig)) {
    sendError(res, "Code118", 403);
    return;
  }

  if (nonce) {
    const cacheKey = `appsig:${apiKey}:${nonce}`;
    const existing = getCache(cacheKey);
    if (existing) {
      sendError(res, "Code120", 409);
      return;
    }
    setCache(cacheKey, "1", Math.ceil(WINDOW_MS / 1000));
  }

  next();
};

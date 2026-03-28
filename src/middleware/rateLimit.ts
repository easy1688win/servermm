import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { sendError } from '../utils/response';

// 通用API速率限制 - 适用于大部分API端点
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 每个IP在15分钟内最多100次请求
  message: {
    code: 2,
    key: 'Code429',
    http: 429,
    params: {},
    details: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // 返回速率限制信息在 `RateLimit-*` headers
  legacyHeaders: false, // 禁用 `X-RateLimit-*` headers
  handler: (req: Request, res: Response) => {
    sendError(res, 'Code429', 429, 'Too many requests from this IP, please try again later.');
  }
});

// 严格的速率限制 - 适用于敏感操作（登录、注册等）
export const strictRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 5, // 每个IP在15分钟内最多5次请求
  message: {
    code: 2,
    key: 'Code429',
    http: 429,
    params: {},
    details: 'Too many attempts from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    sendError(res, 'Code429', 429, 'Too many attempts from this IP, please try again later.');
  }
});

// 中等级速率限制 - 适用于一般操作
export const mediumRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 50, // 每个IP在15分钟内最多50次请求
  message: {
    code: 2,
    key: 'Code429',
    http: 429,
    params: {},
    details: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    sendError(res, 'Code429', 429, 'Too many requests from this IP, please try again later.');
  }
});

// 宽松速率限制 - 适用于数据读取操作
export const looseRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 200, // 每个IP在15分钟内最多200次请求
  message: {
    code: 2,
    key: 'Code429',
    http: 429,
    params: {},
    details: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    sendError(res, 'Code429', 429, 'Too many requests from this IP, please try again later.');
  }
});

// 登录专用速率限制 - 更严格
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 10, // 每个IP在15分钟内最多10次登录尝试
  message: {
    code: 2,
    key: 'Code429',
    http: 429,
    params: {},
    details: 'Too many login attempts from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // 成功的请求不计入限制
  handler: (req: Request, res: Response) => {
    sendError(res, 'Code429', 429, 'Too many login attempts from this IP, please try again later.');
  }
});

// 文件上传速率限制
export const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小时
  max: 20, // 每个IP在1小时内最多20次文件上传
  message: {
    code: 2,
    key: 'Code429',
    http: 429,
    params: {},
    details: 'Too many upload attempts from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    sendError(res, 'Code429', 429, 'Too many upload attempts from this IP, please try again later.');
  }
});

// 营销页面跟踪限制（非常宽松）
export const trackingRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 1000, // 每个IP在1分钟内最多1000次跟踪请求
  message: {
    code: 2,
    key: 'Code429',
    http: 429,
    params: {},
    details: 'Too many tracking requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    sendError(res, 'Code429', 429, 'Too many tracking requests from this IP, please try again later.');
  }
});

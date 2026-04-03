import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';

// 生产环境安全错误处理中间件
export const productionErrorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isProduction = process.env.NODE_ENV === 'production';

  // 生成唯一的错误追踪ID
  const traceId = generateTraceId();

  // 记录完整错误信息到日志（生产环境）
  if (isProduction) {
    console.error(`[${traceId}] Production Error:`, {
      message: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
    });
  }

  // 根据环境返回不同级别的错误信息
  if (isProduction) {
    // 生产环境：返回安全的通用错误信息
    handleProductionError(error, req, res, traceId);
  } else {
    // 开发环境：返回详细错误信息用于调试
    handleDevelopmentError(error, req, res, traceId);
  }
};

// 生产环境错误处理
const handleProductionError = (
  error: Error,
  req: Request,
  res: Response,
  traceId: string
) => {
  // 根据错误类型返回安全的错误信息
  let errorCode = 'Code500';
  let httpStatus = 500;
  let userMessage = 'Internal server error';

  // 验证错误
  if (error.name === 'ValidationError') {
    errorCode = 'Code400';
    httpStatus = 400;
    userMessage = 'Invalid request data';
  }
  // JWT错误
  else if (error.name === 'JsonWebTokenError') {
    errorCode = 'Code103';
    httpStatus = 401;
    userMessage = 'Invalid authentication token';
  }
  // JWT过期错误
  else if (error.name === 'TokenExpiredError') {
    errorCode = 'Code103';
    httpStatus = 401;
    userMessage = 'Authentication token expired';
  }
  // 数据库连接错误
  else if (error.message.includes('ECONNREFUSED')) {
    errorCode = 'Code500';
    httpStatus = 503;
    userMessage = 'Service temporarily unavailable';
  }
  // 权限错误
  else if (error.message.includes('permission') || error.message.includes('access')) {
    errorCode = 'Code102';
    httpStatus = 403;
    userMessage = 'Access denied';
  }
  // 资源未找到
  else if (error.message.includes('not found') || error.message.includes('NotFound')) {
    errorCode = 'Code404';
    httpStatus = 404;
    userMessage = 'Resource not found';
  }
  // 速率限制错误
  else if (error.message.includes('rate limit') || error.message.includes('Too many requests')) {
    errorCode = 'Code429';
    httpStatus = 429;
    userMessage = 'Too many requests';
  }

  // 返回安全的错误响应
  sendError(res, errorCode, httpStatus, {
    traceId,
    timestamp: new Date().toISOString(),
  });
};

// 开发环境错误处理
const handleDevelopmentError = (
  error: Error,
  req: Request,
  res: Response,
  traceId: string
) => {
  // 开发环境返回详细错误信息
  const statusCode = (error as any).statusCode || 500;
  
  res.status(statusCode).json({
    code: 2,
    key: 'DEV_ERROR',
    http: statusCode,
    params: {},
    details: {
      message: error.message,
      stack: error.stack,
      traceId,
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method,
      body: req.body,
      query: req.query,
      params: req.params,
    },
  });
};

// 生成追踪ID
const generateTraceId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`.toUpperCase();
};

// 异步错误捕获包装器
export const asyncErrorHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404错误处理
export const notFoundHandler = (req: Request, res: Response) => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  if (isDevelopment) {
    res.status(404).json({
      code: 2,
      key: 'Code404',
      http: 404,
      params: {},
      details: {
        message: 'Route not found',
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString(),
      },
    });
  } else {
    sendError(res, 'Code404', 404, {
      timestamp: new Date().toISOString(),
    });
  }
};

// 全局未捕获异常处理
export const setupGlobalErrorHandlers = () => {
  // 未捕获的异常
  process.on('uncaughtException', (error: Error) => {
    console.error('Uncaught Exception:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    
    // 优雅关闭
    process.exit(1);
  });

  // 未处理的Promise拒绝
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    console.error('Unhandled Rejection:', {
      reason,
      promise,
      timestamp: new Date().toISOString(),
    });
    
    // 在生产环境中，我们记录但不退出
    if (process.env.NODE_ENV === 'production') {
      console.error('Unhandled Promise Rejection - continuing execution');
    } else {
      process.exit(1);
    }
  });
};

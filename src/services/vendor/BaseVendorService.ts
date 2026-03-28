import { Request, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { logAudit, getClientIp } from '../AuditService';

// ============================================
// 供应商服务基类
// 提供公共功能: HTTP请求、日志、配置管理
// ============================================

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  retries?: number;
}

export abstract class BaseVendorService {
  protected gameId: number;
  protected config: any = null;

  constructor(gameId: number) {
    this.gameId = gameId;
  }

  // ============================================
  // HTTP 请求封装 (统一超时、重试、日志)
  // ============================================
  protected async httpRequest(
    url: string, 
    options: HttpRequestOptions = {}
  ): Promise<any> {
    const { 
      method = 'GET', 
      headers = {}, 
      body, 
      timeout = 30000,
      retries = 3 
    } = options;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const fetchOptions: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          signal: controller.signal,
        };

        if (body && method !== 'GET') {
          fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        // 尝试解析JSON，如果失败返回文本
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          return await response.json();
        }
        return await response.text();

      } catch (error: any) {
        lastError = error;
        
        // 如果是最后一次尝试，抛出错误
        if (attempt === retries) {
          throw new Error(`Request failed after ${retries} attempts: ${error.message}`);
        }

        // 指数退避重试
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  // ============================================
  // 审计日志 (统一格式)
  // ============================================
  protected async logVendorAction(
    userId: number | null,
    action: string,
    input: any,
    output: any,
    ip: string | null
  ): Promise<void> {
    await logAudit(
      userId,
      action,
      input,
      output,
      ip
    );
  }

  // ============================================
  // 配置管理
  // ============================================
  protected setConfig(config: any): void {
    this.config = config;
  }

  protected getConfig(): any {
    return this.config;
  }

  // ============================================
  // 生成唯一请求ID (用于转账等幂等操作)
  // ============================================
  protected generateRequestId(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // ============================================
  // URL 构建辅助
  // ============================================
  protected buildUrl(baseUrl: string, path: string, params?: Record<string, string>): string {
    const url = new URL(path, baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, value);
        }
      });
    }
    return url.toString();
  }

  // ============================================
  // 数据转换辅助
  // ============================================
  protected parseXmlOrJson(data: string): any {
    // 尝试JSON解析
    try {
      return JSON.parse(data);
    } catch {
      // 如果不是JSON，返回原始数据
      return data;
    }
  }

  shouldVerifyTransferOnError(errorMessage?: string): boolean {
    const m = String(errorMessage || '').toLowerCase();
    return (
      m.includes('timeout') ||
      m.includes('timed out') ||
      m.includes('network') ||
      m.includes('fetch') ||
      m.includes('econn') ||
      m.includes('enotfound') ||
      m.includes('eai_again') ||
      m.includes('socket hang up') ||
      m.includes('connection reset')
    );
  }
}

// ============================================
// 供应商服务统一导出
// ============================================

// 类型定义
export * from './types';

// 基类
export { BaseVendorService, HttpRequestOptions } from './BaseVendorService';

// 工厂
export { VendorFactory } from './VendorFactory';

// 适配器（按需导入）
export { JokerVendorService } from './adapters/JokerVendorService';

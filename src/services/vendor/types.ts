// ============================================
// 统一供应商服务接口定义
// 所有供应商适配器必须实现此接口
// ============================================

export interface VendorServiceInterface {
  // 玩家管理
  createPlayer(username: string): Promise<VendorResult>;
  setPlayerStatus(username: string, status: 'Active' | 'Suspend'): Promise<VendorResult>;
  setPlayerPassword(username: string, password: string): Promise<VendorResult>;
  logoutPlayer(username: string): Promise<VendorResult>;
  
  // 资金管理
  getBalance(username: string): Promise<VendorBalanceResult>;
  deposit(username: string, amount: number, requestId?: string): Promise<VendorTransactionResult>;
  withdraw(username: string, amount: number, requestId?: string): Promise<VendorTransactionResult>;
  withdrawAll(username: string, requestId?: string): Promise<VendorTransactionResult>;
  
  // 游戏启动
  launchGame(username: string, gameCode: string, options?: LaunchOptions): Promise<VendorLaunchResult>;
  
  // 可用性检查
  isAvailable(): Promise<boolean>;

  /**
   * TCH/查单：用于在 TC 结果不确定（例如超时/网络中断）时确认 RequestID 是否已被处理。
   * - 返回 success=true 表示该 RequestID 存在且已处理完成（避免重复存取）。
   * - 返回 success=false 表示不存在/未处理/无法确认。
   */
  verifyTransfer?(requestId: string): Promise<VendorResult & { data?: any }>;

  /**
   * 供应商自定义策略：当 TC 失败时，是否需要走 verifyTransfer(RequestID) 进行确认。
   * - 用于实现“方案A”：仅在不确定的失败（网络/超时）才查单，业务明确失败不查单。
   */
  shouldVerifyTransferOnError?(errorMessage?: string): boolean;
}

// 通用返回类型
export interface VendorResult {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
  status?: 'Created' | 'Exists' | 'Failed';
}

export interface VendorBalanceResult extends VendorResult {
  username?: string;
  credit?: number;
  outstandingCredit?: number;
  freeCredit?: number;
  outstandingFreeCredit?: number;
}

export interface VendorTransactionResult extends VendorResult {
  username?: string;
  requestId?: string;
  credit?: number;
  beforeCredit?: number;
  amount?: number;
  time?: string;
}

export interface VendorLaunchResult extends VendorResult {
  url?: string;
}

export interface LaunchOptions {
  mode?: 0 | 1;
  amount?: number;
  language?: string;
  template?: string;
}

// 供应商配置类型
export interface VendorConfig {
  apiUrl: string;
  [key: string]: any;
}

import { JokerProvider, JokerConfig } from '../../../vendors/JokerProvider';
import { 
  VendorServiceInterface, 
  VendorResult, 
  VendorBalanceResult, 
  VendorTransactionResult, 
  VendorLaunchResult,
  LaunchOptions 
} from '../types';
import { BaseVendorService } from '../BaseVendorService';
import Game from '../../../models/Game';
import { decrypt, isEncrypted } from '../../../utils/encryption';

// ============================================
// Joker 供应商服务适配器
// 继承 BaseVendorService 复用公共功能
// 仅实现 Joker 特有的业务逻辑
// ============================================

export class JokerVendorService extends BaseVendorService implements VendorServiceInterface {
  private provider: JokerProvider | null = null;

  constructor(gameId: number) {
    super(gameId);
  }

  // ============================================
  // 初始化 Joker Provider
  // ============================================
  private async initProvider(): Promise<JokerProvider> {
    if (this.provider) {
      return this.provider;
    }

    const game = await Game.findByPk(this.gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (!game.use_api) {
      throw new Error('Game does not have API enabled');
    }

    const vendorConfig = game.vendor_config;
    let normalizedConfig: any = vendorConfig;
    if (typeof normalizedConfig === 'string') {
      const s = normalizedConfig.trim();
      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          normalizedConfig = JSON.parse(s);
        } catch {
          normalizedConfig = null;
        }
      } else {
        normalizedConfig = null;
      }
    }

    if (!normalizedConfig || typeof normalizedConfig !== 'object') {
      throw new Error('Game vendor configuration not found');
    }

    const { apiUrl, appId, signatureKey } = normalizedConfig as Record<string, string>;

    if (!apiUrl || !appId || !signatureKey) {
      throw new Error('Missing required Joker configuration (apiUrl, appId, signatureKey)');
    }

    // Decrypt signature key if it's encrypted
    const decryptedSignatureKey = isEncrypted(signatureKey)
      ? decrypt(signatureKey)
      : signatureKey;

    const config: JokerConfig = {
      apiUrl,
      appId,
      signatureKey: decryptedSignatureKey,
    };

    this.provider = new JokerProvider(config);
    return this.provider;
  }

  // ============================================
  // 可用性检查
  // ============================================
  static async isAvailable(gameId: number): Promise<boolean> {
    try {
      const game = await Game.findByPk(gameId);
      if (!game) return false;
      if (!game.use_api) return false;

      let vendorConfig: any = game.vendor_config;
      if (typeof vendorConfig === 'string') {
        const s = vendorConfig.trim();
        if (s.startsWith('{') || s.startsWith('[')) {
          try {
            vendorConfig = JSON.parse(s);
          } catch {
            vendorConfig = null;
          }
        } else {
          vendorConfig = null;
        }
      }

      if (!vendorConfig || typeof vendorConfig !== 'object' || Array.isArray(vendorConfig)) return false;

      const { apiUrl, appId, signatureKey } = vendorConfig as Record<string, string>;
      return !!(apiUrl && appId && signatureKey);
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return JokerVendorService.isAvailable(this.gameId);
  }

  // ============================================
  // 玩家管理
  // ============================================
  async createPlayer(username: string): Promise<VendorResult> {
    try {
      const provider = await this.initProvider();
      const result = await provider.createPlayer(username);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to create player',
          code: 'CREATE_FAILED',
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        status: result.data?.Status === 'Created' ? 'Created' : 'Exists',
        message: result.data?.Status === 'Created' 
          ? 'Player created successfully' 
          : 'Player already exists',
        code: result.data?.Status === 'Created' ? 'CREATED' : 'EXISTS',
        vendor: 'Joker',
        raw: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error',
        code: 'ERROR',
        vendor: 'Joker',
      };
    }
  }

  async setPlayerStatus(username: string, status: 'Active' | 'Suspend'): Promise<VendorResult> {
    try {
      const provider = await this.initProvider();
      const result = await provider.setPlayerStatus(username, status);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to set player status',
          vendor: 'Joker',
          raw: result,
        };
      }

      return { success: true, vendor: 'Joker', raw: result };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  async setPlayerPassword(username: string, password: string): Promise<VendorResult> {
    try {
      const provider = await this.initProvider();
      const result = await provider.setPlayerPassword(username, password);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to set player password',
          vendor: 'Joker',
          raw: result,
        };
      }

      return { success: true, vendor: 'Joker', raw: result };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  async logoutPlayer(username: string): Promise<VendorResult> {
    try {
      const provider = await this.initProvider();
      const result = await provider.logoutPlayer(username);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to logout player',
          vendor: 'Joker',
          raw: result,
        };
      }

      return { success: true, vendor: 'Joker', raw: result };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  // ============================================
  // 资金管理
  // ============================================
  async getBalance(username: string): Promise<VendorBalanceResult> {
    try {
      const provider = await this.initProvider();
      const result = await provider.getCredit(username);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to get balance',
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        username: result.data?.Username,
        credit: result.data?.Credit,
        outstandingCredit: result.data?.OutstandingCredit,
        freeCredit: result.data?.FreeCredit,
        outstandingFreeCredit: result.data?.OutstandingFreeCredit,
        vendor: 'Joker',
        raw: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  async deposit(username: string, amount: number, requestId?: string): Promise<VendorTransactionResult> {
    try {
      if (amount <= 0) {
        throw new Error('Amount must be positive for deposit');
      }

      const reqId = requestId || this.generateRequestId();
      const provider = await this.initProvider();
      const result = await provider.transferCredit(username, amount, reqId);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to deposit',
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        username: result.data?.Username,
        requestId: result.data?.RequestID,
        credit: result.data?.Credit,
        beforeCredit: result.data?.BeforeCredit,
        amount: amount,
        time: result.data?.Time,
        vendor: 'Joker',
        raw: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  async withdraw(username: string, amount: number, requestId?: string): Promise<VendorTransactionResult> {
    try {
      if (amount <= 0) {
        throw new Error('Amount must be positive for withdrawal');
      }

      const reqId = requestId || this.generateRequestId();
      const provider = await this.initProvider();
      const result = await provider.transferCredit(username, -amount, reqId);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to withdraw',
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        username: result.data?.Username,
        requestId: result.data?.RequestID,
        credit: result.data?.Credit,
        beforeCredit: result.data?.BeforeCredit,
        amount: -amount,
        time: result.data?.Time,
        vendor: 'Joker',
        raw: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  async withdrawAll(username: string, requestId?: string): Promise<VendorTransactionResult> {
    try {
      const reqId = requestId || this.generateRequestId();
      const provider = await this.initProvider();
      const result = await provider.withdrawAll(username, reqId);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to withdraw all credit',
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        username: result.data?.Username,
        requestId: result.data?.RequestID,
        amount: result.data?.Amount,
        time: result.data?.Time,
        vendor: 'Joker',
        raw: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  // ============================================
  // 游戏启动
  // ============================================
  async launchGame(
    username: string, 
    gameCode: string, 
    options?: LaunchOptions
  ): Promise<VendorLaunchResult> {
    try {
      const provider = await this.initProvider();
      const result = await provider.launchGame(username, gameCode, {
        mode: options?.mode,
        amount: options?.amount,
        language: options?.language || 'zh',
        template: options?.template,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to launch game',
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        url: result.data?.Url,
        vendor: 'Joker',
        raw: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  // ============================================
  // 扩展功能 (GameVendorController 使用)
  // ============================================

  async verifyTransfer(requestId: string): Promise<VendorResult & { data?: any }> {
    try {
      const provider = await this.initProvider();
      const result = await provider.verifyTransfer(requestId);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Transfer not found',
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        data: {
          username: result.data?.Username,
          requestId: result.data?.RequestID,
          amount: result.data?.Amount,
          time: result.data?.Time,
        },
        vendor: 'Joker',
        raw: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  async getGameList(): Promise<VendorResult & { games?: any[] }> {
    try {
      const provider = await this.initProvider();
      const result = await provider.getGameList();
      if (!result.success) {
        return {
          success: false,
          error: result.error || result.message || 'Failed to get game list',
          message: result.message,
          vendor: 'Joker',
          raw: result,
        };
      }
      return {
        success: true,
        message: result.message || 'OK',
        vendor: 'Joker',
        raw: result,
        games: result.data?.games || [],
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get game list',
        vendor: 'Joker',
      };
    }
  }

  async getTransactionsByHour(
    startDate: string,
    endDate: string,
    options?: { nextId?: string }
  ): Promise<VendorResult & { data?: any; nextId?: any; games?: any }> {
    try {
      const provider = await this.initProvider();
      const result = await provider.getTransactionsByHour(startDate, endDate, options);

      if (!result.success) {
        return {
          success: false,
          error: result.error || result.message || 'Failed to get transactions',
          message: result.message,
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        message: result.message || 'OK',
        vendor: 'Joker',
        raw: result,
        data: result.data?.data,
        nextId: result.data?.nextId,
        games: result.data?.games,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get transactions',
        vendor: 'Joker',
      };
    }
  }

  async getTransactionsByMinute(
    startDate: string,
    endDate: string,
    options?: { nextId?: string }
  ): Promise<VendorResult & { data?: any; nextId?: any; games?: any }> {
    try {
      const provider = await this.initProvider();
      const result = await provider.getTransactionsByMinute(startDate, endDate, options);

      if (!result.success) {
        return {
          success: false,
          error: result.error || result.message || 'Failed to get transactions',
          message: result.message,
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        message: result.message || 'OK',
        vendor: 'Joker',
        raw: result,
        data: result.data?.data,
        nextId: result.data?.nextId,
        games: result.data?.games,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get transactions',
        vendor: 'Joker',
      };
    }
  }

  async getWinloss(
    startDate: string,
    endDate: string,
    username?: string
  ): Promise<VendorResult & { winloss?: any[] }> {
    try {
      const provider = await this.initProvider();
      const result = await provider.getWinloss(startDate, endDate, username);

      if (!result.success) {
        return {
          success: false,
          error: result.error || result.message || 'Failed to get winloss data',
          message: result.message,
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        message: result.message || 'OK',
        vendor: 'Joker',
        raw: result,
        winloss: result.data?.Winloss || [],
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get winloss data',
        vendor: 'Joker',
      };
    }
  }

  async getHistoryUrl(ocode: string, language?: string): Promise<VendorResult & { url?: string }> {
    try {
      const provider = await this.initProvider();
      const result = await provider.getHistoryUrl(ocode, { language });

      if (!result.success) {
        return {
          success: false,
          error: result.error || result.message || 'Failed to get history URL',
          message: result.message,
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        message: result.message || 'OK',
        vendor: 'Joker',
        raw: result,
        url: result.data?.Url,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }

  async getJackpot(): Promise<VendorResult & { amount?: number }> {
    try {
      const provider = await this.initProvider();
      const result = await provider.getJackpot();

      if (!result.success) {
        return {
          success: false,
          error: result.error || result.message || 'Failed to get jackpot',
          message: result.message,
          vendor: 'Joker',
          raw: result,
        };
      }

      return {
        success: true,
        message: result.message || 'OK',
        vendor: 'Joker',
        raw: result,
        amount: result.data?.Amount,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        vendor: 'Joker',
      };
    }
  }
}

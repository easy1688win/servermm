import { VendorServiceInterface } from './types';
import { JokerVendorService } from './adapters/JokerVendorService';
import { Game, Product } from '../../models';

// ============================================
// providerCode 到供应商类型的映射表
// ============================================
const PROVIDER_CODE_MAP: Record<number, string> = {
  76: 'joker',  // JOKER 游戏的实际 providerCode
  // 未来扩展:
  // 2: 'pragmatic',
  // 3: 'evolution',
  // 4: 'pgsoft',
};

// ============================================
// 供应商服务构造函数映射
// ============================================
const SERVICE_REGISTRY: Record<string, new (gameId: number) => VendorServiceInterface> = {
  joker: JokerVendorService,
  // 未来扩展:
  // pragmatic: PragmaticVendorService,
  // evolution: EvolutionVendorService,
};

// ============================================
// 供应商服务工厂
// 根据 providerCode 返回对应的服务实例
// ============================================
export class VendorFactory {
  /**
   * 根据 providerCode 获取供应商服务
   * @param providerCode - Product 表中的 providerCode
   * @param gameId - 游戏ID
   * @returns 供应商服务实例或 null
   */
  static async getServiceByProviderCode(
    providerCode: number,
    gameId: number
  ): Promise<VendorServiceInterface | null> {
    const vendorType = PROVIDER_CODE_MAP[providerCode];
    if (!vendorType) {
      return null;
    }

    const ServiceClass = SERVICE_REGISTRY[vendorType];
    if (!ServiceClass) {
      return null;
    }

    return new ServiceClass(gameId);
  }

  /**
   * 根据游戏ID自动获取供应商服务
   * 自动查询 Game 关联的 Product 获取 providerCode
   * @param gameId - 游戏ID
   * @returns 供应商服务实例或 null
   */
  static async getServiceByGame(gameId: number): Promise<VendorServiceInterface | null> {
    try {
      const game = await Game.findByPk(gameId as any);
      if (!game) {
        return null;
      }

      if (!game.use_api) {
        return null;
      }

      const product = await Product.findByPk(game.product_id as any);
      if (!product) {
        return null;
      }

      return this.getServiceByProviderCode(product.providerCode, gameId);
    } catch (error) {
      return null;
    }
  }

  /**
   * 根据游戏名称获取供应商服务
   * @param gameName - 游戏名称
   * @returns 供应商服务实例或 null
   */
  static async getServiceByGameName(gameName: string): Promise<VendorServiceInterface | null> {
    try {
      const game = await Game.findOne({
        where: { name: gameName },
      });

      if (!game) {
        return null;
      }

      return this.getServiceByGame(game.id);
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取所有已注册的供应商类型
   */
  static getRegisteredVendors(): string[] {
    return Object.values(PROVIDER_CODE_MAP);
  }

  /**
   * 检查 providerCode 是否有效
   */
  static isValidProviderCode(providerCode: number): boolean {
    return providerCode in PROVIDER_CODE_MAP;
  }

  /**
   * 获取 providerCode 对应的供应商类型名称
   */
  static getVendorTypeByCode(providerCode: number): string | null {
    return PROVIDER_CODE_MAP[providerCode] || null;
  }
}

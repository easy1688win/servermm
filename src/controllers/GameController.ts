import { Request, Response } from 'express';
import { Game, GameAdjustment, Product, Role, SubBrand, Transaction, User } from '../models';
import { logAudit } from '../services/AuditService';
import { AuthRequest } from '../middleware/auth';
import sequelize from '../config/database';
import { decrypt, encrypt, isEncrypted } from '../utils/encryption';
import { VendorFieldDef, getVendorFieldDefsFromKeys, isAllowedVendorFieldKey } from '../vendors/vendorFieldRegistry';
import { sendSuccess, sendError } from '../utils/response';
import { getTenancyScopeOrThrow, withTenancyCreate, withTenancyWhere } from '../tenancy/scope';

const isValidUrl = (url: string): boolean => {
  if (!url) return true; // Allow empty/null URLs
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const normalizeIp = (ip: string | null | undefined): string | null => {
  if (!ip) return null;
  if (ip === '::1') return '127.0.0.1';
  if (ip.startsWith('::ffff:')) return ip.substring(7);
  return ip;
};

const getClientIp = (req: Request): string | null => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0].trim();
    const normalized = normalizeIp(first);
    if (normalized) return normalized;
  }
  const remote = req.socket.remoteAddress || null;
  return normalizeIp(remote);
};

let gameSynced = false;
let productSynced = false;

const ensureGamesSynced = async () => {
  if (!gameSynced) {
    await Game.sync({ alter: true });
    gameSynced = true;
  }
  if (!productSynced) {
    await Product.sync({ alter: true });
    productSynced = true;
  }
};

const normalizeVendorFieldKeys = (raw: any): string[] => {
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('[') || s.startsWith('{')) {
      try {
        raw = JSON.parse(s);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const key =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object' && typeof (item as any).key === 'string'
          ? String((item as any).key).trim()
          : '';
    if (!key) continue;
    if (!isAllowedVendorFieldKey(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
};

const maskSecretValue = (value: any): any => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.length === 0) return '';
  return '******';
};

const normalizeVendorConfigRaw = (raw: any): Record<string, any> | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!(s.startsWith('{') || s.startsWith('['))) return null;
    try {
      raw = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, any>;
};

export const __test__ = {
  normalizeVendorConfigRaw,
};

const validateAndBuildVendorConfig = (
  fields: VendorFieldDef[],
  rawConfig: any,
  mode: 'create' | 'update',
  existingConfig?: Record<string, any> | null,
): { config: Record<string, any>; error?: string } => {
  const base: Record<string, any> =
    mode === 'update' ? (normalizeVendorConfigRaw(existingConfig) ? { ...(normalizeVendorConfigRaw(existingConfig) as any) } : {}) : {};

  const allowedKeys = new Set(fields.map((f) => f.key));

  if (rawConfig === undefined || rawConfig === null) {
    if (mode === 'create' && allowedKeys.size > 0) return { config: {}, error: 'G201' };
    return { config: base };
  }

  if (typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return { config: {}, error: 'G202' };
  }

  for (const key of Object.keys(rawConfig)) {
    if (!allowedKeys.has(key)) {
      return { config: {}, error: 'G203' };
    }
  }

  for (const def of fields) {
    if (!(def.key in rawConfig)) continue;
    const value = (rawConfig as any)[def.key];

    if (value === undefined) continue;
    if (value === null || value === '') {
      return { config: {}, error: 'G204' };
      continue;
    }

    if (def.type === 'number') {
      const num = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(num)) return { config: {}, error: 'G205' };
      base[def.key] = num;
      continue;
    }

    if (typeof value !== 'string') return { config: {}, error: 'G206' };
    const s = value.trim();
    if (!s) return { config: {}, error: 'G204' };

    if (def.type === 'url' && s && !isValidUrl(s)) return { config: {}, error: 'G207' };

    if (def.secret) {
      base[def.key] = isEncrypted(s) ? s : encrypt(s);
    } else {
      base[def.key] = s;
    }
  }

  if (mode === 'create') {
    for (const def of fields) {
      const v = base[def.key];
      if (v === undefined || v === null || v === '') {
        return { config: {}, error: 'G204' };
      }
    }
  }

  return { config: base };
};

const maskVendorConfigForResponse = (
  fields: VendorFieldDef[],
  config: any,
): Record<string, any> | null => {
  const normalized = normalizeVendorConfigRaw(config);
  if (!normalized) return null;
  const out: Record<string, any> = {};
  for (const def of fields) {
    if (!(def.key in normalized)) continue;
    const v = (normalized as any)[def.key];
    if (def.key === 'signatureKey' && typeof v === 'string') {
      out[def.key] = isEncrypted(v) ? decrypt(v) : v;
      continue;
    }
    out[def.key] = def.secret ? maskSecretValue(v) : v;
  }
  return out;
};

export const getAllGames = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    const userPermissions = req.user?.permissions || [];
    const canViewGames = (userPermissions as string[]).includes('view:games');
    const games = await Game.findAll({
      where: withTenancyWhere(scope, { status: 'active' }),
      order: [['name', 'ASC']]
    });
    const formatted = games.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      status: g.status,
      balance: canViewGames ? Number(g.balance) : null,
      kioskUrl: g.kioskUrl,
      kioskUsername: g.kioskUsername,
      kioskPassword: g.kioskPassword
    }));
    sendSuccess(res, 'Code1', formatted);
  } catch (error) {
    sendError(res, 'Code1000', 500); // Error fetching games
  }
};

export const getGamesContext = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    await ensureGamesSynced();
    const userPermissions = req.user?.permissions || [];
    const canViewGames = (userPermissions as string[]).includes('view:games');
    const [games, products] = await Promise.all([
      Game.findAll({
        where: withTenancyWhere(scope, { status: 'active' }),
        order: [['name', 'ASC']],
      }),
      Product.findAll({
        where: { status: 'active' } as any,
        order: [['provider', 'ASC']],
      }),
    ]);

    const productMap = new Map<number, any>();
    (products as any[]).forEach((p: any) => productMap.set(p.id, p));

    const formattedProducts = (products as any[]).map((p: any) => ({
      id: p.id,
      provider: p.provider,
      providerCode: p.providerCode,
      vendorFields: normalizeVendorFieldKeys(p.vendorFields),
      icon: p.icon || null,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    const formattedGames = (games as any[]).map((g: any) => {
      const product = g.product_id ? productMap.get(g.product_id) : null;
      const vendorFieldKeys = product ? normalizeVendorFieldKeys(product.vendorFields) : [];
      const vendorFields = getVendorFieldDefsFromKeys(vendorFieldKeys);
      const maskedVendorConfig = product ? maskVendorConfigForResponse(vendorFields, g.vendor_config) : null;
      return {
        id: g.id,
        name: g.name,
        icon: g.icon,
        status: g.status,
        balance: canViewGames ? Number(g.balance) : null,
        kioskUrl: g.kioskUrl,
        kioskUsername: g.kioskUsername,
        kioskPassword: g.kioskPassword,
        productId: g.product_id || null,
        vendorConfig: maskedVendorConfig,
        useApi: Boolean(g.use_api),
      };
    });

    let subBrands: any[] = [];
    try {
      const requesterId = req.user?.id;
      const requester = requesterId
        ? await User.findByPk(requesterId, { include: [{ model: Role, through: { attributes: [] }, required: false }] } as any)
        : null;
      if (requester) {
        const isSuperAdmin =
          Boolean(req.user?.is_super_admin) ||
          Boolean((requester as any)?.Roles?.some((r: Role) => String((r as any)?.name).toLowerCase() === 'super admin'));
        const isOperator = Boolean((requester as any)?.Roles?.some((r: Role) => String((r as any)?.name).toLowerCase() === 'operator'));
        if (isSuperAdmin) {
          subBrands = await SubBrand.findAll({ order: [['id', 'ASC']] });
        } else if (isOperator) {
          const tid = Number((requester as any)?.tenant_id ?? null);
          if (Number.isFinite(tid) && tid > 0) {
            subBrands = await SubBrand.findAll({ where: { tenant_id: tid } as any, order: [['id', 'ASC']] });
          }
        }
      }
    } catch {
    }

    sendSuccess(res, 'Code1', {
      generatedAt: new Date().toISOString(),
      games: formattedGames,
      products: formattedProducts,
      subBrands,
    });
  } catch (error) {
    console.error('Error fetching games context:', error);
    sendError(res, 'Code1001', 500); // Error fetching games context
  }
};

export const createGame = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    await ensureGamesSynced();
    const { balance, kioskUrl, kioskUsername, kioskPassword } = req.body;
    const productId = req.body?.productId !== undefined ? Number(req.body.productId) : null;
    const useApi = Boolean(req.body?.useApi);
    const vendorConfig = req.body?.vendorConfig;
    
    if (productId === null || Number.isNaN(productId)) {
      sendError(res, 'Code1002', 400); // Invalid product ID
      return;
    }

    // Validate kioskUrl if provided
    if (kioskUrl && !isValidUrl(kioskUrl)) {
      sendError(res, 'Code1003', 400); // Invalid URL
      return;
    }

    const resolvedProduct = await Product.findByPk(productId);
    if (!resolvedProduct || resolvedProduct.status !== 'active') {
      sendError(res, 'Code1004', 400); // Product not found or inactive
      return;
    }

    const trimmedName = String(resolvedProduct.provider).trim();
    const derivedIcon = resolvedProduct.icon || null;

    const existing = await Game.findOne({
      where: withTenancyWhere(scope, { name: trimmedName }),
    } as any);

    if (existing) {
      if (existing.status === 'inactive') {
        const original = {
          id: existing.id,
          name: existing.name,
          balance: Number(existing.balance),
          icon: existing.icon,
          status: existing.status,
          kioskUrl: existing.kioskUrl,
          kioskUsername: existing.kioskUsername,
          kioskPassword: existing.kioskPassword,
        };

        let maskedVendorConfig: Record<string, any> | null = null;
        (existing as any).product_id = resolvedProduct.id;
        existing.name = trimmedName;
        existing.icon = derivedIcon;
        (existing as any).use_api = useApi;

        if (useApi) {
          const vendorFields = getVendorFieldDefsFromKeys(normalizeVendorFieldKeys(resolvedProduct.vendorFields));
          const built = validateAndBuildVendorConfig(vendorFields, vendorConfig, 'create', null);
          if (built.error) {
            sendError(res, 'Code1005', 400, { detail: built.error }); // Built error
            return;
          }

          (existing as any).vendor_config = built.config;
          maskedVendorConfig = maskVendorConfigForResponse(vendorFields, built.config);
        } else {
          (existing as any).vendor_config = null;
        }

        // 用当前「添加游戏」表单中的数据覆盖余额和图标
        if (balance !== undefined && balance !== null) {
          (existing as any).balance = balance;
        }
        if (kioskUrl !== undefined) {
          (existing as any).kioskUrl = kioskUrl;
        }
        if (kioskUsername !== undefined) {
          (existing as any).kioskUsername = kioskUsername;
        }
        if (kioskPassword !== undefined) {
          (existing as any).kioskPassword = kioskPassword;
        }
        existing.status = 'active';

        await existing.save();

        await logAudit(
          req.user?.id || null,
          'GAME_RESTORE',
          original,
          {
            id: existing.id,
            name: existing.name,
            balance: Number(existing.balance),
            icon: existing.icon,
            status: existing.status,
            kioskUrl: existing.kioskUrl,
            kioskUsername: existing.kioskUsername,
            kioskPassword: existing.kioskPassword,
          },
          getClientIp(req) || undefined,
        );

        sendSuccess(res, 'Code1', {
          id: existing.id,
          name: existing.name,
          balance: Number(existing.balance),
          icon: existing.icon,
          status: existing.status,
          kioskUrl: existing.kioskUrl,
          kioskUsername: existing.kioskUsername,
          kioskPassword: existing.kioskPassword,
          productId: (existing as any).product_id || null,
          vendorConfig: maskedVendorConfig,
          useApi: Boolean((existing as any).use_api),
        });
        return;
      }

      sendError(res, 'Code1006', 400); // Game already exists
      return;
    }

    let storedVendorConfig: Record<string, any> | null = null;
    let maskedVendorConfig: Record<string, any> | null = null;

    if (useApi) {
      const vendorFields = getVendorFieldDefsFromKeys(normalizeVendorFieldKeys(resolvedProduct.vendorFields));
      const built = validateAndBuildVendorConfig(vendorFields, vendorConfig, 'create', null);
      if (built.error) {
        sendError(res, 'Code1005', 400, { detail: built.error }); // Built error
        return;
      }
      storedVendorConfig = built.config;
      maskedVendorConfig = maskVendorConfigForResponse(vendorFields, storedVendorConfig);
    }

    const game = await Game.create(withTenancyCreate(scope, {
      name: trimmedName,
      balance: balance || 0,
      icon: derivedIcon,
      kioskUrl,
      kioskUsername,
      kioskPassword,
      product_id: resolvedProduct.id,
      vendor_config: storedVendorConfig,
      use_api: useApi,
      status: 'active'
    }));
    await logAudit(
      req.user?.id || null,
      'GAME_CREATE',
      null,
      {
        id: game.id,
        name: game.name,
        balance: Number(game.balance),
        icon: game.icon,
        status: game.status,
        kioskUrl: game.kioskUrl,
        kioskUsername: game.kioskUsername,
        kioskPassword: game.kioskPassword,
        productId: (game as any).product_id || null,
      },
      getClientIp(req) || undefined,
    );
    sendSuccess(res, 'Code1007', {
      id: game.id,
      name: game.name,
      balance: Number(game.balance),
      icon: game.icon,
      status: game.status,
      kioskUrl: game.kioskUrl,
      kioskUsername: game.kioskUsername,
      kioskPassword: game.kioskPassword,
      productId: (game as any).product_id || null,
      vendorConfig: maskedVendorConfig,
      useApi: Boolean((game as any).use_api),
    }, undefined, 201); // Created successfully, mapped to generic Code1007 success could be just Code1 for creation. We use Code1.
  } catch (error) {
    console.error('Error creating game:', error);
    sendError(res, 'Code1007', 500); // Error creating game
  }
};

export const deleteGame = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    const { id } = req.params;
    const game = await Game.findOne({ where: withTenancyWhere(scope, { id: Number(id) }) } as any);
    
    if (!game) {
      sendError(res, 'Code1008', 404); // Game not found
      return;
    }

    if (game.status === 'inactive') {
      sendSuccess(res, 'Code1009'); // Game already inactive
      return;
    }

    const original = {
      id: game.id,
      name: game.name,
      balance: Number(game.balance),
      icon: game.icon,
      status: game.status,
      kioskUrl: game.kioskUrl,
      kioskUsername: game.kioskUsername,
      kioskPassword: game.kioskPassword,
    };

    game.status = 'inactive';
    await game.save();

    await logAudit(
      req.user?.id || null,
      'GAME_DELETE',
      original,
      {
        id: game.id,
        name: game.name,
        balance: Number(game.balance),
        icon: game.icon,
        status: game.status,
        kioskUrl: game.kioskUrl,
        kioskUsername: game.kioskUsername,
        kioskPassword: game.kioskPassword,
      },
      getClientIp(req) || undefined,
    );

    sendSuccess(res, 'Code1010'); // Game updated (deleted)
  } catch (error) {
    sendError(res, 'Code1011', 500); // Error updating game (deleting)
  }
};

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    await ensureGamesSynced();
    const { id } = req.params;
    const { kioskUrl, kioskUsername, kioskPassword } = req.body;
    const nextProductIdRaw = req.body?.productId;
    const nextVendorConfigRaw = req.body?.vendorConfig;
    const nextUseApiRaw = req.body?.useApi;
    
    const game = await Game.findOne({ where: withTenancyWhere(scope, { id: Number(id) }) } as any);
    if (!game) {
      sendError(res, 'Code1008', 404); // Game not found
      return;
    }

    // Validate kioskUrl if provided
    if (kioskUrl !== undefined && kioskUrl !== null && kioskUrl !== '' && !isValidUrl(kioskUrl)) {
      sendError(res, 'Code1003', 400); // Invalid URL
      return;
    }

    const original = game.toJSON();
    
    // Update all provided fields (including empty strings to clear values)
    if (kioskUrl !== undefined) {
      game.kioskUrl = kioskUrl;
    }
    if (kioskUsername !== undefined) {
      game.kioskUsername = kioskUsername;
    }
    if (kioskPassword !== undefined) {
      game.kioskPassword = kioskPassword;
    }
    if (nextUseApiRaw !== undefined) {
      (game as any).use_api = Boolean(nextUseApiRaw);
    }

    let maskedVendorConfig: Record<string, any> | null = null;
    const productIdChanged =
      nextProductIdRaw !== undefined &&
      Number(nextProductIdRaw) !== Number((game as any).product_id || 0);

    if (nextProductIdRaw !== undefined) {
      const nextProductId = nextProductIdRaw === null ? null : Number(nextProductIdRaw);
      if (nextProductId !== null && Number.isNaN(nextProductId)) {
        sendError(res, 'Code1004', 400); // Product not found
        return;
      }

      if (nextProductId === null) {
        (game as any).product_id = null;
        (game as any).vendor_config = null;
        game.name = game.name;
        game.icon = game.icon;
      } else {
        const product = await Product.findByPk(nextProductId);
        if (!product || product.status !== 'active') {
          sendError(res, 'Code1004', 400); // Product not found or inactive
          return;
        }
        (game as any).product_id = product.id;
        game.name = String(product.provider).trim();
        game.icon = product.icon || null;

        const useApi = Boolean((game as any).use_api);
        if (useApi) {
          const vendorFields = getVendorFieldDefsFromKeys(normalizeVendorFieldKeys(product.vendorFields));
          const existingCfg =
            !productIdChanged && (game as any).vendor_config && typeof (game as any).vendor_config === 'object'
              ? ((game as any).vendor_config as Record<string, any>)
              : null;

          const built = validateAndBuildVendorConfig(
            vendorFields,
            nextVendorConfigRaw,
            productIdChanged ? 'create' : 'update',
            existingCfg,
          );
          if (built.error) {
            sendError(res, 'Code1005', 400, { detail: built.error }); // Validation error
            return;
          }
          (game as any).vendor_config = built.config;
          maskedVendorConfig = maskVendorConfigForResponse(vendorFields, built.config);
        } else {
          (game as any).vendor_config = null;
        }
      }
    } else if (nextVendorConfigRaw !== undefined) {
      const productId = (game as any).product_id;
      if (!productId) {
        sendError(res, 'Code1004', 400); // Product not found
        return;
      }
      const product = await Product.findByPk(Number(productId));
      if (!product || product.status !== 'active') {
        sendError(res, 'Code1004', 400); // Product not found
        return;
      }
      const useApi = Boolean((game as any).use_api);
      if (useApi) {
        const vendorFields = getVendorFieldDefsFromKeys(normalizeVendorFieldKeys(product.vendorFields));
        const existingCfg =
          (game as any).vendor_config && typeof (game as any).vendor_config === 'object'
            ? ((game as any).vendor_config as Record<string, any>)
            : null;
        const built = validateAndBuildVendorConfig(vendorFields, nextVendorConfigRaw, 'update', existingCfg);
        if (built.error) {
          sendError(res, 'Code1005', 400, { detail: built.error }); // Validation error
          return;
        }
        (game as any).vendor_config = built.config;
        maskedVendorConfig = maskVendorConfigForResponse(vendorFields, built.config);
      } else {
        (game as any).vendor_config = null;
      }
    }
    
    if (nextUseApiRaw !== undefined && !Boolean((game as any).use_api)) {
      (game as any).vendor_config = null;
      maskedVendorConfig = null;
    }

    await game.save();

    await logAudit(
      req.user?.id || null,
      'GAME_UPDATE',
      original,
      game.toJSON(),
      getClientIp(req) || undefined,
    );

    sendSuccess(res, 'Code1', {
      id: game.id,
      name: game.name,
      icon: game.icon,
      status: game.status,
      balance: Number(game.balance),
      kioskUrl: game.kioskUrl,
      kioskUsername: game.kioskUsername,
      kioskPassword: game.kioskPassword,
      productId: (game as any).product_id || null,
      vendorConfig: maskedVendorConfig,
      useApi: Boolean((game as any).use_api),
    });
  } catch (error) {
    console.error('Error updating game:', error);
    sendError(res, 'Code1011', 500); // Error updating game
  }
};

export const adjustBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  const t = await sequelize.transaction();
  try {
    const scope = getTenancyScopeOrThrow(req);
    const userPermissions = req.user?.permissions || [];
    const hasGameOperational = (userPermissions as string[]).includes('action:game_operational');
    
    if (!hasGameOperational) {
      await t.rollback();
      sendError(res, 'Code1012', 403);
      return;
    }

    const { id } = req.params;
    const { amount, type, reason } = req.body;
    const clientIp = getClientIp(req);
    const operatorId = req.user?.id;

    const game = await Game.findOne({
      where: withTenancyWhere(scope, { id: Number(id) }),
      transaction: t,
      lock: t.LOCK.UPDATE,
    } as any);
    if (!game) {
      await t.rollback();
      sendError(res, 'Code1008', 404); // Game not found
      return;
    }

    const beforeBalance = Number(game.balance);
    let afterBalance = beforeBalance;
    const adjustmentAmount = Number(amount);
    const reservedRow = (await Transaction.findOne({
      attributes: [[sequelize.fn('SUM', sequelize.literal('amount + bonus')), 'reserved']],
      where: withTenancyWhere(scope, { status: 'PENDING', type: 'DEPOSIT', game_id: (game as any).id }),
      raw: true,
      transaction: t,
    } as any)) as any;
    const reserved = reservedRow?.reserved != null ? Number(reservedRow.reserved) : 0;
    const available = beforeBalance - (Number.isFinite(reserved) ? reserved : 0);

    if (type === 'TOPUP') {
      afterBalance += adjustmentAmount;
    } else if (type === 'OUT') {
      if (available < adjustmentAmount) {
        await t.rollback();
        sendError(res, 'Code1014', 400); // Insufficient balance for OUT
        return;
      }
      afterBalance -= adjustmentAmount;
      if (afterBalance < reserved) {
        await t.rollback();
        sendError(res, 'Code1014', 400);
        return;
      }
    } else {
      await t.rollback();
      sendError(res, 'Code1013', 400);
      return;
    }

    game.balance = afterBalance;
    await game.save({ transaction: t });

    const operatorName =
      (req.user && (req.user.full_name || req.user.username)) || 'Unknown';

    await GameAdjustment.create(
      withTenancyCreate(scope, {
        game_id: game.id,
        operator_id: operatorId,
        amount: adjustmentAmount,
        type,
        reason,
        operator: operatorName,
        game_balance_after: afterBalance,
        ip_address: clientIp,
      }),
      { transaction: t } as any,
    );

    await t.commit();
    await logAudit(req.user?.id || null, 'GAME_ADJUST', { id: game.id, beforeBalance, afterBalance, amount: adjustmentAmount, type, reason }, { id: game.id, balance: afterBalance, kioskUrl: game.kioskUrl, kioskUsername: game.kioskUsername, kioskPassword: game.kioskPassword }, clientIp || undefined);
    sendSuccess(res, 'Code1', { id: game.id, name: game.name, icon: game.icon, status: game.status, balance: Number(game.balance), kioskUrl: game.kioskUrl, kioskUsername: game.kioskUsername, kioskPassword: game.kioskPassword });
  } catch (error) {
    await t.rollback();
    console.error('Error adjusting game balance:', error);
    sendError(res, 'Code1015', 500);
  }
};

export const getGameAdjustments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    const userPermissions = req.user?.permissions || [];
    const canViewSensitive = (userPermissions as string[]).includes('view:sensitive_logs');
    const adjustments = await GameAdjustment.findAll({
      where: withTenancyWhere(scope) as any,
      order: [['createdAt', 'DESC']]
    });

    const formatted = adjustments.map((a: any) => {
      const amount = a.amount != null ? Number(a.amount) : 0;
      const afterBalance =
        a.game_balance_after != null ? Number(a.game_balance_after) : null;

      let beforeBalance: number | null = null;
      if (afterBalance != null && !Number.isNaN(amount)) {
        if (a.type === 'TOPUP') {
          beforeBalance = afterBalance - amount;
        } else if (a.type === 'OUT') {
          beforeBalance = afterBalance + amount;
        }
      }

      return {
        id: a.id,
        gameId: a.game_id,
        amount,
        type: a.type,
        reason: canViewSensitive ? a.reason : null,
        operator: a.operator,
        ip: canViewSensitive ? (a.ip_address || null) : null,
        beforeBalance,
        afterBalance,
        date: a.createdAt,
      };
    });

    sendSuccess(res, 'Code1', formatted);
  } catch (error) {
    console.error('Error fetching game adjustments:', error);
    sendError(res, 'Code1016', 500);
  }
};

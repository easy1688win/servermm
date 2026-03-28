import { Response } from 'express';
import { Product } from '../models';
import { AuthRequest } from '../middleware/auth';
import { getClientIp, logAudit } from '../services/AuditService';
import { isAllowedVendorFieldKey } from '../vendors/vendorFieldRegistry';
import { sendSuccess, sendError } from '../utils/response';

const toStatus = (raw: any): 'active' | 'inactive' | null => {
  if (raw === 'active' || raw === 'inactive') return raw;
  return null;
};

let productSynced = false;
const ensureProductSynced = async () => {
  if (productSynced) return;
  await Product.sync({ alter: true });
  productSynced = true;
};

const normalizeVendorFieldKeys = (raw: any): string[] | null => {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;

  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const key =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object' && typeof (item as any).key === 'string'
          ? String((item as any).key).trim()
          : '';
    if (!key) return null;
    if (!isAllowedVendorFieldKey(key)) return null;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  if (out.length > 40) return null;
  return out;
};

const getFixedProviderCode = (provider: string): number => {
  const providerCodeMap: Record<string, number> = {
    'joker': 76,
    '918kiss': 45,
    'pussy888': 48,
    'mega888': 32,
  };
  
  const code = providerCodeMap[provider.toLowerCase()];
  if (code !== undefined) {
    return code;
  }
  
  // 如果不是预定义的 provider，返回一个默认值或基于 provider 名称的哈希
  let hash = 0;
  for (let i = 0; i < provider.length; i++) {
    const char = provider.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % 101; // 确保 0-100 范围内
};

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureProductSynced();
    const items = await Product.findAll({
      order: [
        ['provider', 'ASC'],
        ['providerCode', 'ASC'],
      ],
    });
    sendSuccess(res, 'Code1', items);
  } catch (error) {
    sendError(res, 'Code425', 500); // Error fetching products
  }
};

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureProductSynced();
    const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim() : '';
    const icon = typeof req.body?.icon === 'string' ? req.body.icon : null;
    const status = toStatus(req.body?.status) || 'active';
    const vendorFields = normalizeVendorFieldKeys(req.body?.vendorFields);

    if (!provider) {
      sendError(res, 'Code426', 400); // Provider is required
      return;
    }

    if (req.body?.vendorFields !== undefined && vendorFields === null) {
      sendError(res, 'Code427', 400); // Invalid vendor fields
      return;
    }

    const providerCode = getFixedProviderCode(provider);

    const item = await Product.create({
      provider,
      providerCode,
      icon,
      status,
      vendorFields,
    });

    await logAudit(
      req.user?.id || null,
      'PRODUCT_CREATE',
      null,
      item.toJSON(),
      getClientIp(req) || undefined,
    );

    sendSuccess(res, 'Code428', item, undefined, 201); // Product created
  } catch (error) {
    sendError(res, 'Code429', 500); // Error creating product
  }
};

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureProductSynced();
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      sendError(res, 'Code430', 400); // Invalid product id
      return;
    }

    const item = await Product.findByPk(id);
    if (!item) {
      sendError(res, 'Code431', 404); // Product not found
      return;
    }

    const original = item.toJSON();
    let providerChanged = false;

    if (req.body?.provider !== undefined) {
      const provider = typeof req.body.provider === 'string' ? req.body.provider.trim() : '';
      if (!provider) {
        sendError(res, 'Code426', 400); // Provider is required
        return;
      }
      if (provider !== item.provider) {
        item.provider = provider;
        providerChanged = true;
      }
    }

    if (req.body?.status !== undefined) {
      const status = toStatus(req.body.status);
      if (!status) {
        sendError(res, 'Code432', 400); // Invalid status
        return;
      }
      item.status = status;
    }

    if (req.body?.icon !== undefined) {
      item.icon = typeof req.body.icon === 'string' ? req.body.icon : null;
    }

    if (req.body?.vendorFields !== undefined) {
      const vendorFields = normalizeVendorFieldKeys(req.body.vendorFields);
      if (vendorFields === null && req.body.vendorFields !== null) {
        sendError(res, 'Code427', 400); // Invalid vendor fields
        return;
      }
      item.vendorFields = vendorFields as any;
    }

    if (providerChanged) {
      item.providerCode = getFixedProviderCode(item.provider);
    }

    await item.save();

    await logAudit(
      req.user?.id || null,
      'PRODUCT_UPDATE',
      original,
      item.toJSON(),
      getClientIp(req) || undefined,
    );

    sendSuccess(res, 'Code433', item); // Product updated
  } catch (error) {
    sendError(res, 'Code434', 500); // Error updating product
  }
};

export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureProductSynced();
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      sendError(res, 'Code430', 400); // Invalid product id
      return;
    }

    const item = await Product.findByPk(id);
    if (!item) {
      sendError(res, 'Code431', 404); // Product not found
      return;
    }

    const original = item.toJSON();
    await item.destroy();

    await logAudit(
      req.user?.id || null,
      'PRODUCT_DELETE',
      original,
      null,
      getClientIp(req) || undefined,
    );

    sendSuccess(res, 'Code435'); // Product deleted
  } catch (error) {
    sendError(res, 'Code436', 500); // Error deleting product
  }
};

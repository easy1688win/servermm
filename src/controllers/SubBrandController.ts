import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Op } from 'sequelize';
import { Role, SubBrand, Tenant, User, UserTenant } from '../models';
import { sendError, sendSuccess } from '../utils/response';
import { decrypt, isEncrypted } from '../utils/encryption';

const normalizeStatus = (raw: any): 'active' | 'inactive' => (raw === 'inactive' ? 'inactive' : 'active');
const normalizeCode = (raw: string) => raw.trim().toUpperCase();
const isValidCode = (raw: string) => /^[A-Z]{5}$/.test(raw);

const isRequesterSuperAdmin = (req: AuthRequest, requester: any): boolean => {
  return (
    Boolean(req.user?.is_super_admin) ||
    Boolean(requester?.Roles?.some((r: Role) => String((r as any)?.name).toLowerCase() === 'super admin'))
  );
};

const isRequesterOperator = (requester: any): boolean => {
  return Boolean(requester?.Roles?.some((r: Role) => String((r as any)?.name).toLowerCase() === 'operator'));
};

const isRequesterAgent = (requester: any): boolean => {
  return Boolean(requester?.Roles?.some((r: Role) => String((r as any)?.name).toLowerCase() === 'agent'));
};

const getManagedTenantIdsForAgent = async (userId: number, fallbackTenantId?: unknown): Promise<number[]> => {
  const rows = await UserTenant.findAll({ where: { userId }, attributes: ['tenantId'] });
  const ids = rows
    .map((r: any) => Number(r.tenantId))
    .filter((x: number) => Number.isFinite(x) && x > 0);

  const fallback = Number(fallbackTenantId ?? null);
  if (Number.isFinite(fallback) && fallback > 0 && !ids.includes(fallback)) {
    ids.push(fallback);
  }
  return ids;
};

const resolveUserFullNamePlain = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (isEncrypted(raw)) {
    const dec = decrypt(raw);
    const out = typeof dec === 'string' ? dec.trim() : '';
    if (out && out !== raw) return out;
    return null;
  }
  return raw;
};

export const listSubBrands = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user?.id;
    const requester = requesterId
      ? await User.findByPk(requesterId, { include: [{ model: Role, through: { attributes: [] }, required: false }] } as any)
      : null;
    if (!requester) {
      sendError(res, 'Code101', 401);
      return;
    }

    const isSuperAdmin = isRequesterSuperAdmin(req, requester);
    const isOperator = isRequesterOperator(requester);
    const isAgent = isRequesterAgent(requester);
    if (!isSuperAdmin && !isOperator && !isAgent) {
      sendError(res, 'Code102', 403);
      return;
    }

    const where: any = {};
    if (isSuperAdmin) {
      const tenantIdRaw = req.query.tenantId;
      const tenantId = tenantIdRaw !== undefined ? Number(tenantIdRaw) : null;
      if (tenantId !== null && Number.isFinite(tenantId) && tenantId > 0) {
        where.tenant_id = tenantId;
      }
    } else if (isAgent) {
      const fallbackTenantId = (requester as any)?.tenant_id ?? req.user?.tenant_id ?? null;
      const managed = await getManagedTenantIdsForAgent(requesterId!, fallbackTenantId);
      if (managed.length === 0) {
        sendSuccess(res, 'Code1', []);
        return;
      }
      const tenantIdRaw = req.query.tenantId;
      const tenantId = tenantIdRaw !== undefined ? Number(tenantIdRaw) : null;
      if (tenantId !== null && Number.isFinite(tenantId) && tenantId > 0) {
        if (!managed.includes(tenantId)) {
          sendError(res, 'Code102', 403);
          return;
        }
        where.tenant_id = tenantId;
      } else {
        where.tenant_id = managed;
      }
    } else {
      const tenantId = Number((requester as any).tenant_id ?? null);
      if (!Number.isFinite(tenantId) || tenantId <= 0) {
        sendError(res, 'Code102', 403);
        return;
      }
      where.tenant_id = tenantId;
    }

    const items = await SubBrand.findAll({
      where: Object.keys(where).length ? where : undefined,
      order: [['id', 'ASC']],
      include: [
        { model: User, as: 'createdBy', attributes: ['id', 'full_name'], required: false } as any,
        { model: User, as: 'updatedBy', attributes: ['id', 'full_name'], required: false } as any,
      ],
    } as any);
    const shaped = (items as any[]).map((sb: any) => {
      const x = typeof sb?.toJSON === 'function' ? sb.toJSON() : sb;
      const createdBy = x?.createdBy
        ? { id: x.createdBy.id, full_name: resolveUserFullNamePlain(x.createdBy.full_name) }
        : null;
      const updatedBy = x?.updatedBy
        ? { id: x.updatedBy.id, full_name: resolveUserFullNamePlain(x.updatedBy.full_name) }
        : null;
      return { ...x, createdBy, updatedBy };
    });
    sendSuccess(res, 'Code1', shaped);
  } catch {
    sendError(res, 'Code603', 500);
  }
};

export const createSubBrand = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user?.id;
    const requester = requesterId
      ? await User.findByPk(requesterId, { include: [{ model: Role, through: { attributes: [] }, required: false }] } as any)
      : null;
    if (!requester) {
      sendError(res, 'Code101', 401);
      return;
    }
    const isSuperAdmin = isRequesterSuperAdmin(req, requester);
    const isOperator = isRequesterOperator(requester);
    const isAgent = isRequesterAgent(requester);
    if (!isSuperAdmin && !isOperator && !isAgent) {
      sendError(res, 'Code102', 403);
      return;
    }

    const tenantId = Number(req.body?.tenant_id ?? req.body?.tenantId ?? null);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const codeRaw = typeof req.body?.code === 'string' ? req.body.code : '';
    const code = normalizeCode(codeRaw);
    const status = normalizeStatus(req.body?.status);

    if (!Number.isFinite(tenantId) || tenantId <= 0 || !name || !code) {
      sendError(res, 'Code1211', 400);
      return;
    }
    if (!isValidCode(code)) {
      sendError(res, 'Code1211', 400, { detail: 'settings_subbrands_code_must_be_5_letters' });
      return;
    }

    if (isAgent) {
      const fallbackTenantId = (requester as any)?.tenant_id ?? req.user?.tenant_id ?? null;
      const managed = await getManagedTenantIdsForAgent(requesterId!, fallbackTenantId);
      if (!managed.includes(tenantId)) {
        sendError(res, 'Code102', 403);
        return;
      }
    } else if (!isSuperAdmin) {
      const requesterTenantId = Number((requester as any).tenant_id ?? null);
      if (!Number.isFinite(requesterTenantId) || requesterTenantId <= 0 || tenantId !== requesterTenantId) {
        sendError(res, 'Code102', 403);
        return;
      }
    }

    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) {
      sendError(res, 'Code1212', 404);
      return;
    }

    const limitRaw = (tenant as any).sub_brand_limit;
    const limit = limitRaw !== undefined && limitRaw !== null ? Number(limitRaw) : null;
    if (limit && Number.isFinite(limit) && limit > 0) {
      const current = await SubBrand.count({
        where: { tenant_id: tenantId, status: { [Op.ne]: 'inactive' } } as any,
      });
      if (current >= limit) {
        sendError(
          res,
          'Code1219',
          409,
          { detail: 'settings_subbrands_limit_reached' },
          { limit, current },
        );
        return;
      }
    }

    const existing = await SubBrand.findOne({ where: { code } as any });
    if (existing) {
      sendError(res, 'Code1213', 409);
      return;
    }

    const created = await SubBrand.create({
      tenant_id: tenantId,
      code,
      name,
      status,
      created_by: req.user?.id ?? null,
      updated_by: req.user?.id ?? null,
    } as any);
    sendSuccess(res, 'Code1210', created);
  } catch {
    sendError(res, 'Code1214', 500);
  }
};

export const updateSubBrand = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.user?.id;
    const requester = requesterId
      ? await User.findByPk(requesterId, { include: [{ model: Role, through: { attributes: [] }, required: false }] } as any)
      : null;
    if (!requester) {
      sendError(res, 'Code101', 401);
      return;
    }
    const isSuperAdmin = isRequesterSuperAdmin(req, requester);
    const isOperator = isRequesterOperator(requester);
    const isAgent = isRequesterAgent(requester);
    if (!isSuperAdmin && !isOperator && !isAgent) {
      sendError(res, 'Code102', 403);
      return;
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      sendError(res, 'Code1215', 400);
      return;
    }

    const sb = await SubBrand.findByPk(id);
    if (!sb) {
      sendError(res, 'Code1216', 404);
      return;
    }

    const previousStatus = String((sb as any).status ?? 'active') as 'active' | 'inactive';

    if (!isSuperAdmin && !isAgent) {
      const requesterTenantId = Number((requester as any).tenant_id ?? null);
      const sbTenantId = Number((sb as any).tenant_id ?? null);
      if (!Number.isFinite(requesterTenantId) || requesterTenantId <= 0 || requesterTenantId !== sbTenantId) {
        sendError(res, 'Code102', 403);
        return;
      }
    } else if (isAgent) {
      const fallbackTenantId = (requester as any)?.tenant_id ?? req.user?.tenant_id ?? null;
      const managed = await getManagedTenantIdsForAgent(requesterId!, fallbackTenantId);
      const sbTenantId = Number((sb as any).tenant_id ?? null);
      if (!Number.isFinite(sbTenantId) || !managed.includes(sbTenantId)) {
        sendError(res, 'Code102', 403);
        return;
      }
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const codeRaw = typeof req.body?.code === 'string' ? req.body.code : '';
    const code = normalizeCode(codeRaw);
    const status = req.body?.status !== undefined ? normalizeStatus(req.body.status) : undefined;
    const incomingTenantIdRaw = req.body?.tenant_id ?? req.body?.tenantId;
    if (incomingTenantIdRaw !== undefined && incomingTenantIdRaw !== null) {
      const incomingTenantId = Number(incomingTenantIdRaw);
      const currentTenantId = Number((sb as any).tenant_id ?? null);
      if (Number.isFinite(incomingTenantId) && Number.isFinite(currentTenantId) && incomingTenantId !== currentTenantId) {
        sendError(res, 'Code1211', 400, { detail: 'settings_subbrands_parent_brand_immutable' });
        return;
      }
    }

    if (codeRaw && code && code !== String((sb as any).code ?? '').trim().toUpperCase()) {
      sendError(res, 'Code1211', 400, { detail: 'settings_subbrands_code_immutable' });
      return;
    }
    if (name) (sb as any).name = name;
    if (status) (sb as any).status = status;
    (sb as any).updated_by = req.user?.id ?? (sb as any).updated_by ?? null;

    const nextStatus = String((sb as any).status ?? 'active') as 'active' | 'inactive';

    const sequelize = (SubBrand as any).sequelize;
    if (sequelize) {
      await sequelize.transaction(async (t: any) => {
        await sb.save({ transaction: t });
        if (previousStatus !== 'inactive' && nextStatus === 'inactive') {
          await User.update(
            { status: 'locked' } as any,
            {
              where: {
                sub_brand_id: sb.id,
                status: { [Op.ne]: 'locked' },
              } as any,
              transaction: t,
            },
          );
        } else if (previousStatus === 'inactive' && nextStatus === 'active') {
          await User.update(
            { status: 'active' } as any,
            {
              where: {
                sub_brand_id: sb.id,
                status: 'locked',
              } as any,
              transaction: t,
            },
          );
        }
      });
    } else {
      await sb.save();
      if (previousStatus !== 'inactive' && nextStatus === 'inactive') {
        await User.update(
          { status: 'locked' } as any,
          {
            where: {
              sub_brand_id: sb.id,
              status: { [Op.ne]: 'locked' },
            } as any,
          },
        );
      } else if (previousStatus === 'inactive' && nextStatus === 'active') {
        await User.update(
          { status: 'active' } as any,
          {
            where: {
              sub_brand_id: sb.id,
              status: 'locked',
            } as any,
          },
        );
      }
    }
    sendSuccess(res, 'Code1217', sb);
  } catch {
    sendError(res, 'Code1218', 500);
  }
};

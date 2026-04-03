import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Role, SubBrand, Tenant, User } from '../models';
import { sendError, sendSuccess } from '../utils/response';

const normalizeStatus = (raw: any): 'active' | 'inactive' => (raw === 'inactive' ? 'inactive' : 'active');

const isRequesterSuperAdmin = (req: AuthRequest, requester: any): boolean => {
  return (
    Boolean(req.user?.is_super_admin) ||
    Boolean(requester?.Roles?.some((r: Role) => String((r as any)?.name).toLowerCase() === 'super admin'))
  );
};

const isRequesterOperator = (requester: any): boolean => {
  return Boolean(requester?.Roles?.some((r: Role) => String((r as any)?.name).toLowerCase() === 'operator'));
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
    if (!isSuperAdmin && !isOperator) {
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
    } else {
      const tenantId = Number((requester as any).tenant_id ?? null);
      if (!Number.isFinite(tenantId) || tenantId <= 0) {
        sendError(res, 'Code102', 403);
        return;
      }
      where.tenant_id = tenantId;
    }

    const items = await SubBrand.findAll({ where: Object.keys(where).length ? where : undefined, order: [['id', 'ASC']] });
    sendSuccess(res, 'Code1', items);
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
    if (!isSuperAdmin && !isOperator) {
      sendError(res, 'Code102', 403);
      return;
    }

    const tenantId = Number(req.body?.tenant_id ?? req.body?.tenantId ?? null);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const status = normalizeStatus(req.body?.status);

    if (!Number.isFinite(tenantId) || tenantId <= 0 || !name || !code) {
      sendError(res, 'Code1211', 400);
      return;
    }

    if (!isSuperAdmin) {
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

    const existing = await SubBrand.findOne({ where: { code } as any });
    if (existing) {
      sendError(res, 'Code1213', 409);
      return;
    }

    const created = await SubBrand.create({ tenant_id: tenantId, code, name, status } as any);
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
    if (!isSuperAdmin && !isOperator) {
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

    if (!isSuperAdmin) {
      const requesterTenantId = Number((requester as any).tenant_id ?? null);
      const sbTenantId = Number((sb as any).tenant_id ?? null);
      if (!Number.isFinite(requesterTenantId) || requesterTenantId <= 0 || requesterTenantId !== sbTenantId) {
        sendError(res, 'Code102', 403);
        return;
      }
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const status = req.body?.status !== undefined ? normalizeStatus(req.body.status) : undefined;

    if (code) {
      const existing = await SubBrand.findOne({ where: { code } as any });
      if (existing && existing.id !== sb.id) {
        sendError(res, 'Code1213', 409);
        return;
      }
      (sb as any).code = code;
    }
    if (name) (sb as any).name = name;
    if (status) (sb as any).status = status;

    await sb.save();
    sendSuccess(res, 'Code1217', sb);
  } catch {
    sendError(res, 'Code1218', 500);
  }
};

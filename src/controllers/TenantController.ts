import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Op } from 'sequelize';
import { Permission, Role, SubBrand, Tenant, User, UserRole, UserTenant } from '../models';
import { sendError, sendSuccess } from '../utils/response';
import { decrypt, isEncrypted } from '../utils/encryption';
import { TENANT_DEFAULT_ROLE_SPECS } from '../constants/systemRoles';

const normalizeStatus = (raw: any): 'active' | 'inactive' => (raw === 'inactive' ? 'inactive' : 'active');
const normalizePrefix = (raw: string) => raw.trim().toUpperCase();
const isValidPrefix = (raw: string) => /^[A-Z]{5}$/.test(raw);

const parseOptionalPositiveInt = (raw: any): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
};

const ensureTenantDefaultRoles = async (tenantId: number): Promise<void> => {
  if (!Number.isFinite(tenantId) || tenantId <= 0) return;

  const allPerms = await Permission.findAll();
  const bySlug = new Map<string, any>();
  for (const p of allPerms as any[]) {
    bySlug.set(String(p.slug), p);
  }

  for (const spec of TENANT_DEFAULT_ROLE_SPECS) {
    const [role] = await Role.findOrCreate({
      where: { tenant_id: tenantId, name: spec.name } as any,
      defaults: { tenant_id: tenantId, name: spec.name, description: spec.description, isSystem: false } as any,
    });

    const wantAll = Array.isArray(spec.permissions) && spec.permissions.includes('*');
    if (wantAll) {
      await (role as any).setPermissions(allPerms);
    } else {
      const unique = Array.from(new Set((spec.permissions || []).map((x) => String(x))));
      const perms = unique.map((s) => bySlug.get(s)).filter(Boolean);
      await (role as any).setPermissions(perms);
    }
  }
};

const getRequesterRoleFlags = async (req: AuthRequest) => {
  if (!req.user?.id) {
    return { isSuperAdmin: false, isAgent: false };
  }
  const requester: any = await User.findByPk(req.user.id, {
    include: [{ model: Role, through: { attributes: [] }, required: false }],
  } as any);
  const roles = Array.isArray(requester?.Roles) ? requester.Roles : [];
  const isSuperAdmin =
    Boolean(req.user?.is_super_admin) ||
    roles.some((r: any) => String(r?.name ?? '').toLowerCase() === 'super admin');
  const isAgent = roles.some((r: any) => String(r?.name ?? '').toLowerCase() === 'agent');
  return { isSuperAdmin, isAgent };
};

const getManagedTenantIdsForUser = async (userId: number, fallbackTenantId?: unknown): Promise<number[]> => {
  const rows = await UserTenant.findAll({
    where: { userId },
    attributes: ['tenantId'],
  });
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

export const listTenants = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isSuperAdmin, isAgent } = await getRequesterRoleFlags(req);
    if (!isSuperAdmin && !isAgent) {
      sendError(res, 'Code102', 403);
      return;
    }

    let tenants: any[] = [];
    if (isSuperAdmin) {
      tenants = await Tenant.findAll({
        order: [['id', 'ASC']],
        include: [
          { model: User, as: 'createdBy', attributes: ['id', 'full_name'], required: false } as any,
          { model: User, as: 'updatedBy', attributes: ['id', 'full_name'], required: false } as any,
        ],
      } as any);
    } else {
      const ids = await getManagedTenantIdsForUser(req.user!.id, req.user?.tenant_id ?? null);
      if (ids.length === 0) {
        tenants = [];
      } else {
        tenants = await Tenant.findAll({
          where: { id: ids } as any,
          order: [['id', 'ASC']],
          include: [
            { model: User, as: 'createdBy', attributes: ['id', 'full_name'], required: false } as any,
            { model: User, as: 'updatedBy', attributes: ['id', 'full_name'], required: false } as any,
          ],
        } as any);
      }
    }
    const shaped = (tenants as any[]).map((t: any) => {
      const x = typeof t?.toJSON === 'function' ? t.toJSON() : t;
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

export const createTenant = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isSuperAdmin, isAgent } = await getRequesterRoleFlags(req);
    if (!isSuperAdmin && !isAgent) {
      sendError(res, 'Code102', 403);
      return;
    }

    const prefixRaw = typeof req.body?.prefix === 'string' ? req.body.prefix : '';
    const prefix = normalizePrefix(prefixRaw);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const status = normalizeStatus(req.body?.status);
    const requestedLimitRaw = req.body?.subBrandLimit ?? req.body?.sub_brand_limit ?? null;
    const requestedLimit = parseOptionalPositiveInt(requestedLimitRaw);
    const subBrandLimit = isSuperAdmin ? requestedLimit : isAgent ? 11 : null;

    if (!prefix || !name) {
      sendError(res, 'Code1201', 400);
      return;
    }
    if (!isValidPrefix(prefix)) {
      sendError(res, 'Code1201', 400, { detail: 'settings_brands_prefix_must_be_5_letters' });
      return;
    }

    const existing = await Tenant.findOne({ where: { prefix } as any });
    if (existing) {
      sendError(res, 'Code1202', 409);
      return;
    }

    const created = await Tenant.create({
      prefix,
      name,
      status,
      sub_brand_limit: subBrandLimit,
      created_by: req.user?.id ?? null,
      updated_by: req.user?.id ?? null,
    } as any);
    await ensureTenantDefaultRoles(created.id);
    if (isAgent && req.user?.id) {
      await UserTenant.findOrCreate({
        where: { userId: req.user.id, tenantId: created.id } as any,
        defaults: { userId: req.user.id, tenantId: created.id } as any,
      });
      const agentRole = await Role.findOne({ where: { tenant_id: created.id, name: 'Agent' } as any });
      if (agentRole) {
        await UserRole.findOrCreate({ where: { userId: req.user.id, roleId: (agentRole as any).id } as any });
      }
    }
    sendSuccess(res, 'Code1200', created);
  } catch {
    sendError(res, 'Code1203', 500);
  }
};

export const updateTenant = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isSuperAdmin, isAgent } = await getRequesterRoleFlags(req);
    if (!isSuperAdmin && !isAgent) {
      sendError(res, 'Code102', 403);
      return;
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      sendError(res, 'Code1204', 400);
      return;
    }

    if (!isSuperAdmin && isAgent && req.user?.id) {
      const ids = await getManagedTenantIdsForUser(req.user.id, req.user?.tenant_id ?? null);
      if (!ids.includes(id)) {
        sendError(res, 'Code102', 403);
        return;
      }
    }

    const tenant = await Tenant.findByPk(id);
    if (!tenant) {
      sendError(res, 'Code1205', 404);
      return;
    }

    const previousStatus = String((tenant as any).status ?? 'active') as 'active' | 'inactive';
    const prefixRaw = req.body?.prefix;
    const prefix = typeof prefixRaw === 'string' ? normalizePrefix(prefixRaw) : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const status = req.body?.status !== undefined ? normalizeStatus(req.body.status) : undefined;
    const nextLimitRaw = req.body?.subBrandLimit ?? req.body?.sub_brand_limit ?? undefined;
    const nextLimit =
      nextLimitRaw === undefined ? undefined : parseOptionalPositiveInt(nextLimitRaw);

    if (prefixRaw !== undefined) {
      const currentPrefix = normalizePrefix(String((tenant as any).prefix ?? ''));
      if (prefix !== currentPrefix) {
        sendError(res, 'Code1204', 400, { detail: 'settings_brands_prefix_immutable' });
        return;
      }
    }
    if (name) (tenant as any).name = name;
    if (status) (tenant as any).status = status;
    if (nextLimitRaw !== undefined) {
      if (!isSuperAdmin) {
        sendError(res, 'Code102', 403);
        return;
      }
      (tenant as any).sub_brand_limit = nextLimit;
    }
    (tenant as any).updated_by = req.user?.id ?? (tenant as any).updated_by ?? null;

    const nextStatus = String(((tenant as any).status ?? 'active')) as 'active' | 'inactive';

    const sequelize = (Tenant as any).sequelize;
    if (sequelize) {
      await sequelize.transaction(async (t: any) => {
        await tenant.save({ transaction: t });
        if (previousStatus !== 'inactive' && nextStatus === 'inactive') {
          await SubBrand.update(
            { status: 'inactive' } as any,
            { where: { tenant_id: tenant.id } as any, transaction: t },
          );
          await User.update(
            { status: 'locked' } as any,
            {
              where: {
                tenant_id: tenant.id,
                status: { [Op.ne]: 'locked' },
              } as any,
              transaction: t,
            },
          );
        } else if (previousStatus === 'inactive' && nextStatus === 'active') {
          await SubBrand.update(
            { status: 'active' } as any,
            { where: { tenant_id: tenant.id } as any, transaction: t },
          );
          await User.update(
            { status: 'active' } as any,
            {
              where: {
                tenant_id: tenant.id,
                status: 'locked',
              } as any,
              transaction: t,
            },
          );
        }
      });
    } else {
      await tenant.save();
      if (previousStatus !== 'inactive' && nextStatus === 'inactive') {
        await SubBrand.update({ status: 'inactive' } as any, { where: { tenant_id: tenant.id } as any });
        await User.update(
          { status: 'locked' } as any,
          {
            where: {
              tenant_id: tenant.id,
              status: { [Op.ne]: 'locked' },
            } as any,
          },
        );
      } else if (previousStatus === 'inactive' && nextStatus === 'active') {
        await SubBrand.update({ status: 'active' } as any, { where: { tenant_id: tenant.id } as any });
        await User.update(
          { status: 'active' } as any,
          {
            where: {
              tenant_id: tenant.id,
              status: 'locked',
            } as any,
          },
        );
      }
    }
    sendSuccess(res, 'Code1206', tenant);
  } catch {
    sendError(res, 'Code1207', 500);
  }
};

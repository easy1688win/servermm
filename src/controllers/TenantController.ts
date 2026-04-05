import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Op } from 'sequelize';
import { SubBrand, Tenant, User } from '../models';
import { sendError, sendSuccess } from '../utils/response';

const normalizeStatus = (raw: any): 'active' | 'inactive' => (raw === 'inactive' ? 'inactive' : 'active');
const normalizePrefix = (raw: string) => raw.trim().toUpperCase();
const isValidPrefix = (raw: string) => /^[A-Z]{5}$/.test(raw);

export const listTenants = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tenants = await Tenant.findAll({ order: [['id', 'ASC']] });
    sendSuccess(res, 'Code1', tenants);
  } catch {
    sendError(res, 'Code603', 500);
  }
};

export const createTenant = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prefixRaw = typeof req.body?.prefix === 'string' ? req.body.prefix : '';
    const prefix = normalizePrefix(prefixRaw);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const status = normalizeStatus(req.body?.status);

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

    const created = await Tenant.create({ prefix, name, status } as any);
    sendSuccess(res, 'Code1200', created);
  } catch {
    sendError(res, 'Code1203', 500);
  }
};

export const updateTenant = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      sendError(res, 'Code1204', 400);
      return;
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

    if (prefixRaw !== undefined) {
      const currentPrefix = normalizePrefix(String((tenant as any).prefix ?? ''));
      if (prefix !== currentPrefix) {
        sendError(res, 'Code1204', 400, { detail: 'settings_brands_prefix_immutable' });
        return;
      }
    }
    if (name) (tenant as any).name = name;
    if (status) (tenant as any).status = status;

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

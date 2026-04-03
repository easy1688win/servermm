import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Tenant } from '../models';
import { sendError, sendSuccess } from '../utils/response';

const normalizeStatus = (raw: any): 'active' | 'inactive' => (raw === 'inactive' ? 'inactive' : 'active');

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
    const prefix = typeof req.body?.prefix === 'string' ? req.body.prefix.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const status = normalizeStatus(req.body?.status);

    if (!prefix || !name) {
      sendError(res, 'Code1201', 400);
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

    const prefix = typeof req.body?.prefix === 'string' ? req.body.prefix.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const status = req.body?.status !== undefined ? normalizeStatus(req.body.status) : undefined;

    if (prefix) {
      const existing = await Tenant.findOne({ where: { prefix } as any });
      if (existing && existing.id !== tenant.id) {
        sendError(res, 'Code1202', 409);
        return;
      }
      (tenant as any).prefix = prefix;
    }
    if (name) (tenant as any).name = name;
    if (status) (tenant as any).status = status;

    await tenant.save();
    sendSuccess(res, 'Code1206', tenant);
  } catch {
    sendError(res, 'Code1207', 500);
  }
};


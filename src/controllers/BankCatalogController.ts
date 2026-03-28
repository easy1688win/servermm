import { Request, Response } from 'express';
import { BankCatalog } from '../models';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';
import { sendSuccess, sendError } from '../utils/response';

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const items = await BankCatalog.findAll({
      order: [['name', 'ASC']]
    });
    sendSuccess(res, 'Code1', items);
  } catch (error) {
    console.error('Error fetching bank catalog:', error);
    sendError(res, 'Code414', 500); // Error fetching bank catalog
  }
};

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, icon } = req.body;
    
    if (!name) {
      sendError(res, 'Code415', 400); // Bank name is required
      return;
    }

    // Check for duplicate name
    const existing = await BankCatalog.findOne({ where: { name: name.trim() } });
    if (existing) {
      sendError(res, 'Code416', 400); // Bank catalog item already exists
      return;
    }

    const item = await BankCatalog.create({
      name: name.trim(),
      icon
    });

    await logAudit(req.user?.id || null, 'BANK_CATALOG_CREATE', null, { id: item.id, name: item.name, icon: item.icon }, getClientIp(req) || undefined);

    sendSuccess(res, 'Code417', item, undefined, 201); // Bank catalog item created
  } catch (error) {
    console.error('Error creating bank catalog item:', error);
    sendError(res, 'Code418', 500); // Error creating bank catalog item
  }
};

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { icon } = req.body;
    
    const item = await BankCatalog.findByPk(Number(id));
    if (!item) {
      sendError(res, 'Code419', 404); // Bank catalog item not found
      return;
    }

    const original = item.toJSON();
    
    // Only update icon if provided
    if (icon !== undefined) {
      item.icon = icon;
    }
    
    await item.save();

    await logAudit(
      req.user?.id || null,
      'BANK_CATALOG_UPDATE',
      original,
      item.toJSON(),
      getClientIp(req) || undefined,
    );

    sendSuccess(res, 'Code420', item); // Bank catalog item updated
  } catch (error) {
    console.error('Error updating bank catalog item:', error);
    sendError(res, 'Code421', 500); // Error updating bank catalog item
  }
};

export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const item = await BankCatalog.findByPk(Number(id));
    
    if (!item) {
      sendError(res, 'Code419', 404); // Bank catalog item not found
      return;
    }

    const original = item.toJSON();
    await item.destroy();
    
    await logAudit(req.user?.id || null, 'BANK_CATALOG_DELETE', original, null, getClientIp(req) || undefined);
    
    sendSuccess(res, 'Code422'); // Bank catalog item deleted
  } catch (error) {
    console.error('Error deleting bank catalog item:', error);
    sendError(res, 'Code423', 500); // Error deleting bank catalog item
  }
};

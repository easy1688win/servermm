import { Request, Response } from 'express';
import { BankCatalog } from '../models';
import { AuthRequest } from '../middleware/auth';
import { logAudit, getClientIp } from '../services/AuditService';

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const items = await BankCatalog.findAll({
      order: [['name', 'ASC']]
    });
    res.json(items);
  } catch (error) {
    console.error('Error fetching bank catalog:', error);
    res.status(500).json({ message: 'BC101' });
  }
};

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, icon } = req.body;
    
    if (!name) {
      res.status(400).json({ message: 'BC102' });
      return;
    }

    // Check for duplicate name
    const existing = await BankCatalog.findOne({ where: { name: name.trim() } });
    if (existing) {
      res.status(400).json({ message: 'BC106' });
      return;
    }

    const item = await BankCatalog.create({
      name: name.trim(),
      icon
    });

    await logAudit(req.user?.id || null, 'BANK_CATALOG_CREATE', null, { id: item.id, name: item.name, icon: item.icon }, getClientIp(req) || undefined);

    res.status(201).json(item);
  } catch (error) {
    console.error('Error creating bank catalog item:', error);
    res.status(500).json({ message: 'BC103' });
  }
};

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { icon } = req.body;
    
    const item = await BankCatalog.findByPk(Number(id));
    if (!item) {
      res.status(404).json({ message: 'BC104' });
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

    res.json(item);
  } catch (error) {
    console.error('Error updating bank catalog item:', error);
    res.status(500).json({ message: 'BC107' });
  }
};

export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const item = await BankCatalog.findByPk(Number(id));
    
    if (!item) {
      res.status(404).json({ message: 'BC104' });
      return;
    }

    const original = item.toJSON();
    await item.destroy();
    
    await logAudit(req.user?.id || null, 'BANK_CATALOG_DELETE', original, null, getClientIp(req) || undefined);
    
    res.json({ message: 'Item deleted' });
  } catch (error) {
    console.error('Error deleting bank catalog item:', error);
    res.status(500).json({ message: 'BC105' });
  }
};

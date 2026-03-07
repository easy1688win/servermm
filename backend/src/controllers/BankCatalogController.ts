import { Request, Response } from 'express';
import { BankCatalog } from '../models';
import { AuthRequest } from '../middleware/auth';

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const items = await BankCatalog.findAll({
      order: [['name', 'ASC']]
    });
    res.json(items);
  } catch (error) {
    console.error('Error fetching bank catalog:', error);
    res.status(500).json({ message: 'Error fetching bank catalog' });
  }
};

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, icon } = req.body;
    
    if (!name) {
      res.status(400).json({ message: 'Name is required' });
      return;
    }

    const item = await BankCatalog.create({
      name,
      icon
    });

    res.status(201).json(item);
  } catch (error) {
    console.error('Error creating bank catalog item:', error);
    res.status(500).json({ message: 'Error creating item' });
  }
};

export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const item = await BankCatalog.findByPk(Number(id));
    
    if (!item) {
      res.status(404).json({ message: 'Item not found' });
      return;
    }

    await item.destroy();
    res.json({ message: 'Item deleted' });
  } catch (error) {
    console.error('Error deleting bank catalog item:', error);
    res.status(500).json({ message: 'Error deleting item' });
  }
};

import { Request, Response } from 'express';
import { Permission } from '../models';

export const getAllPermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const permissions = await Permission.findAll();
    res.json(permissions);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching permissions' });
  }
};

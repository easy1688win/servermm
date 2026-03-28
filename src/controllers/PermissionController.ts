import { Request, Response } from 'express';
import { Permission } from '../models';
import { sendSuccess, sendError } from '../utils/response';

export const getAllPermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const permissions = await Permission.findAll();
    sendSuccess(res, 'Code1', permissions);
  } catch (error) {
    sendError(res, 'Code454', 500); // Error fetching permissions
  }
};

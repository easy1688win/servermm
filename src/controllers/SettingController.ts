import { Response } from 'express';
import { Setting } from '../models';
import { AuthRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../utils/response';

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const settings = await Setting.findAll();
    const result: Record<string, any> = {};
    settings.forEach((s: any) => {
      // Handle potential double-encoding or stringified JSON from DB
      let val = s.value;
      if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
        try {
          const parsed = JSON.parse(val);
          val = parsed;
        } catch (e) {
          // ignore
        }
      }
      result[s.key] = val;
    });
    sendSuccess(res, 'Code1', result);
  } catch (error) {
    sendError(res, 'Code437', 500); // Error fetching settings
  }
};

export const getByKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawKey = req.params.key;
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const setting = await Setting.findByPk(key);

    if (!setting) {
      sendSuccess(res, 'Code1', null);
      return;
    }

    sendSuccess(res, 'Code1', setting.value);
  } catch (error) {
    sendError(res, 'Code438', 500); // Error fetching setting by key
  }
};

export const setByKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawKey = req.params.key;
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const { value } = req.body;

    if (key === 'maintenance_mode') {
        const strVal = String(value).trim().toLowerCase();
        if (strVal !== 'true' && strVal !== 'false') {
            sendError(res, 'Code439', 400); // Invalid value for maintenance_mode
            return;
        }
    }

    if (key === 'maintenance_allowed_roles') {
        if (!Array.isArray(value)) {
             sendError(res, 'Code440', 400); // Invalid value for maintenance_allowed_roles
             return;
        }
    }
    
    const [setting, created] = await Setting.findOrCreate({
      where: { key },
      defaults: { value }
    });

    if (!created) {
      setting.value = value;
      await setting.save();
    }

    sendSuccess(res, 'Code1', setting);
  } catch (error) {
    sendError(res, 'Code441', 500); // Error setting by key
  }
};

export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const settingsObj = req.body;
    
    if (!settingsObj || typeof settingsObj !== 'object') {
       sendError(res, 'Code442', 400); // Invalid request body
       return;
    }

    const updates = [];

    for (const [key, value] of Object.entries(settingsObj)) {
      if (key === 'maintenance_mode') {
        const strVal = String(value).trim().toLowerCase();
        if (strVal !== 'true' && strVal !== 'false') {
            sendError(res, 'Code439', 400); // Invalid value for maintenance_mode
            return;
        }
      }

      if (key === 'maintenance_allowed_roles') {
        if (!Array.isArray(value)) {
             sendError(res, 'Code440', 400); // Invalid value for maintenance_allowed_roles
             return;
        }
      }

      const [setting, created] = await Setting.findOrCreate({
        where: { key },
        defaults: { key, value }
      });

      if (!created && setting.value !== value) {
        setting.value = value;
        await setting.save();
        updates.push(setting);
      } else if (created) {
        updates.push(setting);
      }
    }

    if (updates.length > 0) {
      sendSuccess(res, 'Code1', updates);
    } else {
      sendSuccess(res, 'Code1', { message: 'No updates needed' });
    }
  } catch (error) {
    sendError(res, 'Code441', 500); // Error updating settings
  }
};


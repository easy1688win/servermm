import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../utils/response';
import { getTenancyScopeOrThrow } from '../tenancy/scope';
import { isGlobalSettingKey, listSettings, setSettingValue, getSettingValue } from '../services/SettingService';

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    const result = await listSettings(scope);
    sendSuccess(res, 'Code1', result);
  } catch (error) {
    sendError(res, 'Code437', 500); // Error fetching settings
  }
};

export const getByKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
    const rawKey = req.params.key;
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const value = await getSettingValue(scope, key);
    sendSuccess(res, 'Code1', value);
  } catch (error) {
    sendError(res, 'Code438', 500); // Error fetching setting by key
  }
};

export const setByKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
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

    const setting = await setSettingValue(scope, key, value);
    sendSuccess(res, 'Code1', setting);
  } catch (error) {
    sendError(res, 'Code441', 500); // Error setting by key
  }
};

export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = getTenancyScopeOrThrow(req);
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

      const setting = await setSettingValue(scope, key, value);
      updates.push(setting);
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

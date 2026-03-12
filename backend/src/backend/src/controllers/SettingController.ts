import { Request, Response } from 'express';
import { Setting } from '../models';
import { AuthRequest } from '../middleware/auth';

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
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'S101' });
  }
};

export const getByKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawKey = req.params.key;
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const setting = await Setting.findByPk(key);

    if (!setting) {
      res.json(null);
      return;
    }

    res.json(setting.value);
  } catch (error) {
    res.status(500).json({ message: 'S102' });
  }
};

export const setByKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawKey = req.params.key;
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const { value } = req.body;
    
    const [setting, created] = await Setting.findOrCreate({
      where: { key },
      defaults: { value }
    });

    if (!created) {
      setting.value = value;
      await setting.save();
    }

    res.json(setting);
  } catch (error) {
    res.status(500).json({ message: 'S103' });
  }
};

import { Op } from 'sequelize';
import { Setting } from '../models';
import { TenancyScope } from '../tenancy/scope';

const SHARED_SETTING_KEYS = new Set<string>(['referralSources', 'tagOptions']);
const MAINTENANCE_KEYS = new Set<string>(['maintenance', 'maintenance_mode', 'maintenance_allowed_roles']);

const isSharedSettingKey = (key: string): boolean => {
  return SHARED_SETTING_KEYS.has(key.trim());
};

export const isGlobalSettingKey = (key: string): boolean => {
  const k = key.trim();
  if (!k) return true;
  if (MAINTENANCE_KEYS.has(k)) return true;
  if (k.startsWith('maintenance_')) return true;
  if (isSharedSettingKey(k)) return true;
  return false;
};

export const toScopedSettingKey = (scope: TenancyScope, key: string): string => {
  return `sb:${scope.sub_brand_id}:${key}`;
};

export const getSettingValue = async (scope: TenancyScope, key: string): Promise<any> => {
  if (isGlobalSettingKey(key)) {
    const setting = await Setting.findByPk(key);
    if (setting) return (setting as any).value;
    if (isSharedSettingKey(key)) {
      const scoped = await Setting.findByPk(toScopedSettingKey(scope, key));
      if (scoped) return (scoped as any).value;
    }
    return null;
  }
  const scopedKey = toScopedSettingKey(scope, key);
  const scoped = await Setting.findByPk(scopedKey);
  if (scoped) return (scoped as any).value;
  const legacy = await Setting.findByPk(key);
  return legacy ? (legacy as any).value : null;
};

export const setSettingValue = async (scope: TenancyScope, key: string, value: any): Promise<Setting> => {
  const storageKey = isGlobalSettingKey(key) ? key : toScopedSettingKey(scope, key);
  const [setting, created] = await Setting.findOrCreate({
    where: { key: storageKey } as any,
    defaults: { key: storageKey, value } as any,
  });
  if (!created) {
    (setting as any).value = value;
    await setting.save();
  }
  return setting;
};

export const listSettings = async (scope: TenancyScope): Promise<Record<string, any>> => {
  const scopedPrefix = `sb:${scope.sub_brand_id}:`;
  const globalKeys = Array.from(new Set<string>([...MAINTENANCE_KEYS.values(), ...SHARED_SETTING_KEYS.values()]));
  const rows = await Setting.findAll({
    where: {
      [Op.or]: [
        { key: { [Op.like]: `${scopedPrefix}%` } },
        { key: { [Op.in]: globalKeys } },
      ],
    } as any,
  });

  const scopedOut: Record<string, any> = {};
  const globalOut: Record<string, any> = {};
  for (const s of rows as any[]) {
    const rawKey: string = String((s as any).key ?? '');
    if (rawKey.startsWith(scopedPrefix)) {
      const publicKey = rawKey.slice(scopedPrefix.length);
      scopedOut[publicKey] = (s as any).value;
    } else {
      globalOut[rawKey] = (s as any).value;
    }
  }
  return { ...scopedOut, ...globalOut };
};

import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';
import { randomBytes } from 'crypto';

const generateProfileUuid = (): string => {
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += String(bytes[i] % 10);
  }
  return out;
};

class Player extends Model {
  public id!: number;
  public player_game_id!: string;
  public profile_uuid!: string;
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
  public tags!: any;
  public metadata!: any;
  public total_in!: number;
  public total_out!: number;
}

Player.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  player_game_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  profile_uuid: {
    type: DataTypes.STRING(6),
    allowNull: true,
  },
  tenant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  sub_brand_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  tags: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  sequelize,
  modelName: 'Player',
  tableName: 'players',
  indexes: [
    { unique: true, fields: ['sub_brand_id', 'player_game_id'] },
    { unique: true, fields: ['profile_uuid'] },
    { fields: ['tenant_id', 'sub_brand_id'] },
  ],
  hooks: {
    beforeCreate: async (instance: Player) => {
      if (!instance.profile_uuid) {
        for (let attempt = 0; attempt < 12; attempt++) {
          const candidate = generateProfileUuid();
          const exists = await Player.count({ where: { profile_uuid: candidate } });
          if (!exists) {
            instance.profile_uuid = candidate;
            break;
          }
        }
        if (!instance.profile_uuid) {
          instance.profile_uuid = generateProfileUuid();
        }
      }
      if (instance.metadata) {
        const str = typeof instance.metadata === 'string' 
          ? instance.metadata 
          : JSON.stringify(instance.metadata);
        
        if (!isEncrypted(str)) {
          instance.metadata = encrypt(str);
        }
      }
    },
    beforeUpdate: (instance: Player) => {
      if (instance.changed('profile_uuid')) {
        instance.setDataValue('profile_uuid', instance.previous('profile_uuid') as any);
      }
      if (instance.changed('metadata') && instance.metadata) {
        const str = typeof instance.metadata === 'string' 
          ? instance.metadata 
          : JSON.stringify(instance.metadata);
        
        if (!isEncrypted(str)) {
          instance.metadata = encrypt(str);
        }
      }
    },
    afterFind: async (instances: Player | Player[] | null) => {
      if (!instances) return;
      
      const decryptInstance = async (inst: Player) => {
        const existingUuid = inst.getDataValue('profile_uuid') as any;
        const hasValidUuid = typeof existingUuid === 'string' && /^\d{6}$/.test(existingUuid);
        if (!hasValidUuid) {
          for (let attempt = 0; attempt < 12; attempt++) {
            const candidate = generateProfileUuid();
            const exists = await Player.count({ where: { profile_uuid: candidate } });
            if (exists) continue;
            inst.setDataValue('profile_uuid', candidate);
            try {
              const where =
                existingUuid == null
                  ? ({ id: inst.getDataValue('id') as any, profile_uuid: null } as any)
                  : ({ id: inst.getDataValue('id') as any, profile_uuid: existingUuid } as any);
              const [updated] = await Player.update({ profile_uuid: candidate }, { where } as any);
              if (updated) break;
            } catch {
              void 0;
            }
          }
        }
        if (inst.metadata) {
          let strValue = inst.metadata;
          
          // Case 1: It's already an object (JSON field parsed by Sequelize)
          if (typeof strValue !== 'string') {
             // Even if it's an object, we need to be careful. 
             // If we previously stored an encrypted string as a JSON string (e.g. "\"81acdb...\""), 
             // Sequelize might parse it as a string literal, so strValue would be that encrypted string.
             // But if typeof is NOT string, it means it's an object/array/null.
             
             // If it's a plain object, it's decrypted data. We are good.
             return; 
          }

          // Case 2: It is a string. It could be:
          // a) The raw encrypted string (e.g. "81acdb...")
          // b) A JSON-stringified encrypted string (e.g. "\"81acdb...\"") - double encoded
          // c) A JSON-stringified object (e.g. "{\"name\":\"...\"}")

          // Try to handle double-encoding (JSON string containing the encrypted string)
          if (strValue.startsWith('"') && strValue.endsWith('"')) {
            try {
              const parsed = JSON.parse(strValue);
              if (typeof parsed === 'string') {
                strValue = parsed;
              }
            } catch (e) {
              // Not a valid JSON string, treat as raw string
            }
          }

          // Now check if this string is encrypted
          if (isEncrypted(strValue)) {
            try {
              const decrypted = decrypt(strValue);
              // Attempt to parse the decrypted string as JSON
              try {
                inst.metadata = JSON.parse(decrypted);
              } catch (jsonError) {
                // If decrypted content is not valid JSON, keep it as string
                inst.metadata = decrypted;
              }
            } catch (e) {
              // Decryption failed. 
              // Fallback: try to parse the original string as JSON
              try {
                 inst.metadata = JSON.parse(strValue); 
              } catch (e2) {
                 // ignore, keep as is
              }
            }
          } else {
            // Not encrypted, try to parse as JSON if it's a string
            try {
               inst.metadata = JSON.parse(strValue); 
            } catch (e2) {
               // ignore
            }
          }
        }
      };

      if (Array.isArray(instances)) {
        await Promise.all(instances.map(decryptInstance));
      } else {
        await decryptInstance(instances);
      }
    }
  }
});

export default Player;

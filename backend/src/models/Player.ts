import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';

class Player extends Model {
  public id!: number;
  public player_game_id!: string;
  public game_id!: number | null;
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
    unique: true,
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
  hooks: {
    beforeCreate: (instance: Player) => {
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
      if (instance.changed('metadata') && instance.metadata) {
        const str = typeof instance.metadata === 'string' 
          ? instance.metadata 
          : JSON.stringify(instance.metadata);
        
        if (!isEncrypted(str)) {
          instance.metadata = encrypt(str);
        }
      }
    },
    afterFind: (instances: Player | Player[] | null) => {
      if (!instances) return;
      
      const decryptInstance = (inst: Player) => {
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
        instances.forEach(decryptInstance);
      } else {
        decryptInstance(instances);
      }
    }
  }
});

export default Player;

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
        if (inst.metadata && typeof inst.metadata === 'string') {
          // Check if it looks encrypted to avoid unnecessary decrypt calls
          if (isEncrypted(inst.metadata)) {
            try {
              const decrypted = decrypt(inst.metadata);
              inst.metadata = JSON.parse(decrypted);
            } catch (e) {
              // Fallback to original string or try to parse it as JSON directly
              try {
                 inst.metadata = JSON.parse(inst.metadata); 
              } catch (e2) {
                 // ignore
              }
            }
          } else {
            // Not encrypted, try to parse as JSON if it's a string
            try {
               inst.metadata = JSON.parse(inst.metadata); 
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

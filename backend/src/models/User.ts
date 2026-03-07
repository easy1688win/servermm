import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';

class User extends Model {
  public id!: number;
  public username!: string;
  public password_hash!: string;
  public status!: 'active' | 'locked';
  public full_name!: string | null;
  public last_login_at!: Date | null;
  public last_login_ip!: string | null;
  public api_key!: string | null;
  public token_version!: number;
  public currency!: 'USD' | 'MYR';
}

User.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password_hash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('active', 'locked'),
    defaultValue: 'active',
  },
  currency: {
    type: DataTypes.ENUM('USD', 'MYR'),
    allowNull: false,
    defaultValue: 'USD',
  },
  api_key: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  full_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  last_login_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  last_login_ip: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  token_version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  sequelize,
  modelName: 'User',
  tableName: 'users',
  hooks: {
    beforeCreate: (instance: User) => {
      if (instance.api_key && !isEncrypted(instance.api_key)) {
        instance.api_key = encrypt(instance.api_key);
      }
      if (instance.full_name && !isEncrypted(instance.full_name)) {
        instance.full_name = encrypt(instance.full_name);
      }
      if (instance.last_login_ip && !isEncrypted(instance.last_login_ip)) {
        instance.last_login_ip = encrypt(instance.last_login_ip);
      }
    },
    beforeUpdate: (instance: User) => {
      if (instance.changed('api_key') && instance.api_key && !isEncrypted(instance.api_key)) {
        instance.api_key = encrypt(instance.api_key);
      }
      if (instance.changed('full_name') && instance.full_name && !isEncrypted(instance.full_name)) {
        instance.full_name = encrypt(instance.full_name);
      }
      if (instance.changed('last_login_ip') && instance.last_login_ip && !isEncrypted(instance.last_login_ip)) {
        instance.last_login_ip = encrypt(instance.last_login_ip);
      }
    },
    afterFind: (instances: User | User[] | null) => {
      if (!instances) return;
      
      const decryptInstance = (inst: User) => {
        // We do NOT decrypt api_key here anymore.
        // It stays encrypted in memory to prevent accidental exposure.
        // Decryption happens explicitly only when needed (e.g. AuthController.getUs).
        
        if (inst.full_name) {
          inst.full_name = decrypt(inst.full_name);
        }
        if (inst.last_login_ip) {
          inst.last_login_ip = decrypt(inst.last_login_ip);
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

export default User;

import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';

class UserSession extends Model {
  public id!: number;
  public user_id!: number;
  public device_id!: string;
  public device_name!: string | null;
  public user_agent!: string | null;
  public ip_address!: string | null;
  public jwt_id!: string;
  public is_active!: boolean;
  public revoked_at!: Date | null;
  public revoked_reason!: string | null;
  public last_active_at!: Date | null;
  public fullname!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UserSession.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    device_id: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    device_name: {
      type: DataTypes.STRING(191),
      allowNull: true,
    },
    user_agent: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    ip_address: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fullname: {
      type: DataTypes.STRING(191),
      allowNull: true,
    },
    jwt_id: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    revoked_reason: {
      type: DataTypes.STRING(191),
      allowNull: true,
    },
    last_active_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'UserSession',
    tableName: 'user_sessions',
    hooks: {
      beforeCreate: (instance: UserSession) => {
        if (instance.fullname && !isEncrypted(instance.fullname)) {
          instance.fullname = encrypt(instance.fullname);
        }
        if (instance.ip_address && !isEncrypted(instance.ip_address)) {
          instance.ip_address = encrypt(instance.ip_address);
        }
      },
      beforeUpdate: (instance: UserSession) => {
        if (instance.changed('fullname') && instance.fullname && !isEncrypted(instance.fullname)) {
          instance.fullname = encrypt(instance.fullname);
        }
        if (instance.changed('ip_address') && instance.ip_address && !isEncrypted(instance.ip_address)) {
          instance.ip_address = encrypt(instance.ip_address);
        }
      },
      afterFind: (instances: UserSession | UserSession[] | null) => {
        if (!instances) return;
        
        const decryptInstance = (inst: UserSession) => {
          if (inst.fullname) {
            inst.fullname = decrypt(inst.fullname);
          }
          if (inst.ip_address) {
            inst.ip_address = decrypt(inst.ip_address);
          }
        };

        if (Array.isArray(instances)) {
          instances.forEach(decryptInstance);
        } else {
          decryptInstance(instances);
        }
      }
    }
  }
);

export default UserSession;


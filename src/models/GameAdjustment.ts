import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';
import Game from './Game';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';

class GameAdjustment extends Model {
  public id!: number;
  public game_id!: number;
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
  public operator_id!: number;
  public amount!: number;
  public type!: 'TOPUP' | 'OUT';
  public reason!: string | null;
  public operator!: string;
  public game_balance_after!: number;
  public ip_address!: string | null;
}

GameAdjustment.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  game_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Game,
      key: 'id',
    },
  },
  tenant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  sub_brand_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  operator_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('TOPUP', 'OUT'),
    allowNull: false,
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  operator: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  game_balance_after: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
  },
  ip_address: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  sequelize,
  modelName: 'GameAdjustment',
  tableName: 'game_adjustments',
  indexes: [
    { fields: ['tenant_id', 'sub_brand_id'] },
    { fields: ['sub_brand_id', 'createdAt'] },
    { fields: ['game_id', 'createdAt'] },
  ],
  hooks: {
    beforeCreate: (instance: GameAdjustment) => {
      if (instance.reason && !isEncrypted(instance.reason)) {
        instance.reason = encrypt(instance.reason);
      }
      if (instance.ip_address && !isEncrypted(instance.ip_address)) {
        instance.ip_address = encrypt(instance.ip_address);
      }
    },
    beforeUpdate: (instance: GameAdjustment) => {
      if (instance.changed('reason') && instance.reason && !isEncrypted(instance.reason)) {
        instance.reason = encrypt(instance.reason);
      }
      if (instance.changed('ip_address') && instance.ip_address && !isEncrypted(instance.ip_address)) {
        instance.ip_address = encrypt(instance.ip_address);
      }
    },
    afterFind: (instances: GameAdjustment | GameAdjustment[] | null) => {
      if (!instances) return;
      const decryptInstance = (inst: GameAdjustment) => {
        if (inst.reason) {
          inst.reason = decrypt(inst.reason);
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
});

export default GameAdjustment;

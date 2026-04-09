import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';
import { generateTransactionId } from '../utils/snowflake';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';

class Transaction extends Model {
  public id!: string;
  public player_id!: number | null;
  public bank_account_id!: number | null;
  public game_id!: number | null;
  public game_account_id!: string | null;
  public operator_id!: number;
  public type!: 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT' | 'WALVE';
  public amount!: number;
  public bonus!: number;
  public tips!: number;
  public status!: 'PENDING' | 'COMPLETED' | 'REJECTED' | 'VOIDED';
  public walve!: number;
  public remark!: string | null;
  public ip_address!: string | null;
  public bank_balance_after!: number;
  public game_balance_after!: number;
  public vendor_credit_before!: number | null;
  public vendor_credit_after!: number | null;
  public vendor_message!: string | null;
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
}

Transaction.init({
  id: {
    type: DataTypes.STRING(25), // Increased to accommodate 64-bit Snowflake IDs
    primaryKey: true,
  },
  player_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  bank_account_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  game_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  game_account_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  operator_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT', 'WALVE'),
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
  },
  bonus: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  tips: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  walve: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'COMPLETED', 'REJECTED', 'VOIDED'),
    defaultValue: 'PENDING',
  },
  remark: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  ip_address: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  bank_balance_after: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
  },
  game_balance_after: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
  },
  vendor_credit_before: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
  },
  vendor_credit_after: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
  },
  vendor_message: {
    type: DataTypes.TEXT,
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
}, {
  sequelize,
  modelName: 'Transaction',
  tableName: 'transactions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['tenant_id', 'sub_brand_id'] },
    { fields: ['tenant_id', 'sub_brand_id', 'created_at'] },
    { fields: ['tenant_id', 'sub_brand_id', 'type', 'created_at'] },
    { fields: ['tenant_id', 'sub_brand_id', 'operator_id', 'created_at'] },
  ],
  hooks: {
    beforeCreate: (transaction) => {
      if (!transaction.id) {
        transaction.id = generateTransactionId();
      }

      // Enforce validation for game-related transactions
      if (['DEPOSIT', 'WITHDRAWAL', 'WALVE'].includes(transaction.type)) {
        if (!transaction.player_id) {
          throw new Error('Player is required for this transaction type');
        }
        if (!transaction.game_id) {
          throw new Error('Game is required for this transaction type');
        }
        if (!transaction.game_account_id) {
          throw new Error('Game Account is required for this transaction type');
        }
      }

      if (transaction.remark && !isEncrypted(transaction.remark)) {
        transaction.remark = encrypt(transaction.remark);
      }
      if (transaction.ip_address && !isEncrypted(transaction.ip_address)) {
        transaction.ip_address = encrypt(transaction.ip_address);
      }
      if (transaction.game_account_id && !isEncrypted(transaction.game_account_id)) {
        transaction.game_account_id = encrypt(transaction.game_account_id);
      }
    },
    beforeUpdate: (transaction) => {
      if (transaction.changed('remark') && transaction.remark && !isEncrypted(transaction.remark)) {
        transaction.remark = encrypt(transaction.remark);
      }
      if (transaction.changed('ip_address') && transaction.ip_address && !isEncrypted(transaction.ip_address)) {
        transaction.ip_address = encrypt(transaction.ip_address);
      }
      if (transaction.changed('game_account_id') && transaction.game_account_id && !isEncrypted(transaction.game_account_id)) {
        transaction.game_account_id = encrypt(transaction.game_account_id);
      }
    },
    afterFind: (instances: Transaction | Transaction[] | null) => {
      if (!instances) return;
      
      const decryptInstance = (inst: Transaction) => {
        if (inst.remark) {
          inst.remark = decrypt(inst.remark);
        }
        if (inst.ip_address) {
          inst.ip_address = decrypt(inst.ip_address);
        }
        if (inst.game_account_id) {
          inst.game_account_id = decrypt(inst.game_account_id);
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

export default Transaction;

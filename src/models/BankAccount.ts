import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';

class BankAccount extends Model {
  public id!: number;
  public bank_name!: string;
  public alias!: string;
  public account_number!: string;
  public total_balance!: number;
  public status!: 'active' | 'inactive' | 'banned';
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
}

BankAccount.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  bank_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  alias: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  account_number: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  total_balance: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'banned'),
    defaultValue: 'active',
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
  modelName: 'BankAccount',
  tableName: 'bank_accounts',
  indexes: [
    { fields: ['tenant_id', 'sub_brand_id'] },
    { fields: ['sub_brand_id', 'status'] },
  ],
  hooks: {
    beforeCreate: (instance: BankAccount) => {
      if (instance.account_number && !isEncrypted(instance.account_number)) {
        instance.account_number = encrypt(instance.account_number);
      }
    },
    beforeUpdate: (instance: BankAccount) => {
      if (instance.changed('account_number') && instance.account_number && !isEncrypted(instance.account_number)) {
        instance.account_number = encrypt(instance.account_number);
      }
    },
    afterFind: (instances: BankAccount | BankAccount[] | null) => {
      if (!instances) return;
      
      const decryptInstance = (inst: BankAccount) => {
        if (inst.account_number && isEncrypted(inst.account_number)) {
          inst.account_number = decrypt(inst.account_number);
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

export default BankAccount;

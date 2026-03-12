import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class BankCatalog extends Model {
  public id!: number;
  public name!: string;
  public icon!: string | null;
}

BankCatalog.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  icon: {
    type: DataTypes.TEXT('medium'),
    allowNull: true,
  },
}, {
  sequelize,
  modelName: 'BankCatalog',
  tableName: 'bank_catalog',
});

export default BankCatalog;

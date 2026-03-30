import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class Tenant extends Model {
  public id!: number;
  public prefix!: string;
  public name!: string;
  public status!: 'active' | 'inactive';
}

Tenant.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    prefix: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      allowNull: false,
      defaultValue: 'active',
    },
  },
  {
    sequelize,
    modelName: 'Tenant',
    tableName: 'tenants',
  },
);

export default Tenant;


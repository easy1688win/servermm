import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class Tenant extends Model {
  public id!: number;
  public prefix!: string;
  public name!: string;
  public status!: 'active' | 'inactive';
  public sub_brand_limit!: number | null;
  public created_by!: number | null;
  public updated_by!: number | null;
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
    sub_brand_limit: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Tenant',
    tableName: 'tenants',
  },
);

export default Tenant;


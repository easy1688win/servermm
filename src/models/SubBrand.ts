import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class SubBrand extends Model {
  public id!: number;
  public tenant_id!: number;
  public code!: string;
  public name!: string;
  public status!: 'active' | 'inactive';
  public created_by!: number | null;
  public updated_by!: number | null;
}

SubBrand.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING,
      allowNull: true,
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
    modelName: 'SubBrand',
    tableName: 'sub_brands',
  },
);

export default SubBrand;


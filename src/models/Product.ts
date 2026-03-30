import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class Product extends Model {
  public id!: number;
  public provider!: string;
  public providerCode!: number;
  public icon!: string | null;
  public status!: 'active' | 'inactive';
  public vendorFields!: string[] | null;
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
}

Product.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    provider: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    providerCode: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 0,
        max: 100,
      },
    },
    icon: {
      type: DataTypes.TEXT('medium'),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      allowNull: false,
      defaultValue: 'active',
    },
    vendorFields: {
      type: DataTypes.JSON,
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
  },
  {
    sequelize,
    modelName: 'Product',
    tableName: 'products',
    indexes: [
      { unique: true, fields: ['provider', 'providerCode'] },
      { fields: ['provider'] },
    ],
  },
);

export default Product;

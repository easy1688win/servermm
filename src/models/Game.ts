import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class Game extends Model {
  public id!: number;
  public name!: string;
  public icon!: string | null;
  public balance!: number;
  public status!: 'active' | 'inactive';
  public kioskUrl!: string | null;
  public kioskUsername!: string | null;
  public kioskPassword!: string | null;
  public product_id!: number | null;
  public vendor_config!: any | null;
  public use_api!: boolean;
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
}

Game.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  tenant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  sub_brand_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  icon: {
    type: DataTypes.TEXT('medium'),
    allowNull: true,
  },
  balance: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active',
  },
  kioskUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  kioskUsername: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  kioskPassword: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  vendor_config: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  use_api: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  sequelize,
  modelName: 'Game',
  tableName: 'games',
  indexes: [
    { unique: true, fields: ['sub_brand_id', 'name'] },
    { fields: ['tenant_id', 'sub_brand_id'] },
    { fields: ['sub_brand_id', 'status'] },
  ],
});

export default Game;

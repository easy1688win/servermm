import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class LandingPage extends Model {
  public id!: number;
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
  public name!: string;
  public page_url!: string;
  public source!: string | null;
  public status!: 'active' | 'inactive';
  public operator_id!: number | null;
  public theme!: 'light' | 'dark' | 'auto';
  public title!: string | null;
  public subtitle!: string | null;
  public hero_image_url!: string | null;
  public primary_cta_text!: string | null;
  public primary_cta_url!: string | null;
  public secondary_cta_text!: string | null;
  public secondary_cta_url!: string | null;
  public created_at!: Date;
  public updated_at!: Date;
}

LandingPage.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    sub_brand_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    page_url: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      allowNull: false,
      defaultValue: 'active',
    },
    operator_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    theme: {
      type: DataTypes.ENUM('light', 'dark', 'auto'),
      allowNull: false,
      defaultValue: 'auto',
    },
    title: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    subtitle: {
      type: DataTypes.STRING(240),
      allowNull: true,
    },
    hero_image_url: {
      type: DataTypes.STRING(2048),
      allowNull: true,
    },
    primary_cta_text: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },
    primary_cta_url: {
      type: DataTypes.STRING(2048),
      allowNull: true,
    },
    secondary_cta_text: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },
    secondary_cta_url: {
      type: DataTypes.STRING(2048),
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'LandingPage',
    tableName: 'landing_pages',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['tenant_id', 'sub_brand_id'] },
      { fields: ['sub_brand_id', 'updated_at'] },
    ],
  }
);

export default LandingPage;

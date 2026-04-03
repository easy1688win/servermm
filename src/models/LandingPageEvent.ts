import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class LandingPageEvent extends Model {
  public id!: number;
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
  public landing_page_id!: number;
  public event_name!: string;
  public element_id!: string | null;
  public session_id!: string | null;
  public ip_hash!: string;
  public ip_enc!: string | null;
  public meta!: any;
  public os!: string | null;
  public browser!: string | null;
  public user_agent!: string | null;
  public device_type!: 'mobile' | 'desktop' | 'tablet' | 'other' | null;
  public language!: string | null;
  public timezone_offset!: number | null;
  public screen!: string | null;
  public is_bot!: boolean;
  public suspected_bot!: boolean;
  public created_at!: Date;
}

LandingPageEvent.init(
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
    landing_page_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    event_name: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    element_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    session_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    ip_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    ip_enc: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    meta: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    os: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    browser: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    user_agent: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    device_type: {
      type: DataTypes.ENUM('mobile', 'desktop', 'tablet', 'other'),
      allowNull: true,
    },
    language: {
      type: DataTypes.STRING(16),
      allowNull: true,
    },
    timezone_offset: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    screen: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    is_bot: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    suspected_bot: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    modelName: 'LandingPageEvent',
    tableName: 'landing_page_events',
    timestamps: true,
    updatedAt: false,
    createdAt: 'created_at',
    indexes: [
      { fields: ['tenant_id', 'sub_brand_id'] },
      { fields: ['sub_brand_id', 'created_at'] },
      { fields: ['landing_page_id', 'created_at'] },
    ],
  }
);

export default LandingPageEvent;

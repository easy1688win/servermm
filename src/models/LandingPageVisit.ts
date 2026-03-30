import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class LandingPageVisit extends Model {
  public id!: number;
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
  public landing_page_id!: number;
  public session_id!: string | null;
  public ip_hash!: string;
  public ip_enc!: string | null;
  public page_url!: string | null;
  public referrer_origin!: string | null;
  public referrer_path!: string | null;
  public utm_source!: string | null;
  public utm_campaign!: string | null;
  public utm_medium!: string | null;
  public utm_content!: string | null;
  public utm_term!: string | null;
  public fbclid!: string | null;
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

LandingPageVisit.init(
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
    page_url: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },
    referrer_origin: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    referrer_path: {
      type: DataTypes.STRING(1024),
      allowNull: true,
    },
    utm_source: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    utm_campaign: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    utm_medium: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    utm_content: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    utm_term: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fbclid: {
      type: DataTypes.STRING(255),
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
    modelName: 'LandingPageVisit',
    tableName: 'landing_page_visits',
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

export default LandingPageVisit;

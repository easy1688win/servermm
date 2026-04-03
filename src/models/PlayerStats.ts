import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class PlayerStats extends Model {
  public id!: number;
  public player_id!: number;
  public tenant_id!: number | null;
  public sub_brand_id!: number | null;
  public date!: string;
  public deposit_count!: number;
  public withdraw_count!: number;
  public total_deposit!: number;
  public total_withdraw!: number;
  public total_walve!: number;
  public total_tips!: number;
  public total_bonus!: number;
  public last_deposit_at!: Date | null;
  public last_withdraw_at!: Date | null;
}

PlayerStats.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    player_id: {
      type: DataTypes.INTEGER,
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
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    deposit_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    withdraw_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    total_deposit: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
    },
    total_withdraw: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
    },
    total_walve: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
    },
    total_tips: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
    },
    total_bonus: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
    },
    last_deposit_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_withdraw_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'PlayerStats',
    tableName: 'player_stats',
    indexes: [
      {
        fields: ['player_id', 'date'],
      },
      { fields: ['tenant_id', 'sub_brand_id'] },
      { fields: ['sub_brand_id', 'date'] },
    ],
  },
);

export default PlayerStats;

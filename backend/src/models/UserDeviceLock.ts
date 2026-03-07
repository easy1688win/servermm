import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class UserDeviceLock extends Model {
  public id!: number;
  public user_id!: number;
  public device_id!: string;
  public locked_by!: number | null;
  public reason!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UserDeviceLock.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    device_id: {
      type: DataTypes.STRING(191),
      allowNull: false,
    },
    locked_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'UserDeviceLock',
    tableName: 'user_device_locks',
  }
);

export default UserDeviceLock;


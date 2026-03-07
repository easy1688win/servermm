import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class UserPermission extends Model {
  public userId!: number;
  public permissionId!: number;
}

UserPermission.init({
  userId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  permissionId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
}, {
  sequelize,
  modelName: 'UserPermission',
  tableName: 'user_permissions',
});

export default UserPermission;

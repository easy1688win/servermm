import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class RolePermission extends Model {
  public roleId!: number;
  public permissionId!: number;
}

RolePermission.init({
  roleId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: {
      model: 'roles',
      key: 'id',
    },
  },
  permissionId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: {
      model: 'permissions',
      key: 'id',
    },
  },
}, {
  sequelize,
  modelName: 'RolePermission',
  tableName: 'role_permissions',
  timestamps: false,
});

export default RolePermission;

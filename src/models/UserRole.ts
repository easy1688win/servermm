import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class UserRole extends Model {
  public userId!: number;
  public roleId!: number;
}

UserRole.init({
  userId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: {
      model: 'users',
      key: 'id',
    },
  },
  roleId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: {
      model: 'roles',
      key: 'id',
    },
  },
}, {
  sequelize,
  modelName: 'UserRole',
  tableName: 'user_roles',
  timestamps: false,
});

export default UserRole;

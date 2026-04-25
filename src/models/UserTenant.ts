import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class UserTenant extends Model {
  public userId!: number;
  public tenantId!: number;
}

UserTenant.init(
  {
    userId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      references: {
        model: 'users',
        key: 'id',
      },
    },
    tenantId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      references: {
        model: 'tenants',
        key: 'id',
      },
    },
  },
  {
    sequelize,
    modelName: 'UserTenant',
    tableName: 'user_tenants',
    timestamps: false,
  },
);

export default UserTenant;

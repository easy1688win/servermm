import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class Role extends Model {
  public id!: number;
  public tenant_id!: number | null;
  public name!: string;
  public description!: string;
  public isSystem!: boolean;
}

Role.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  tenant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'tenants',
      key: 'id',
    },
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  isSystem: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  sequelize,
  modelName: 'Role',
  tableName: 'roles',
  indexes: [
    {
      unique: true,
      fields: ['tenant_id', 'name'],
    },
  ],
});

export default Role;

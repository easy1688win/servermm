import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class Permission extends Model {
  public id!: number;
  public slug!: string;
  public description!: string;
}

Permission.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  sequelize,
  modelName: 'Permission',
  tableName: 'permissions',
});

export default Permission;

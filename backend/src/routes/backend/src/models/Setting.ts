import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class Setting extends Model {
  public key!: string;
  public value!: any;
}

Setting.init({
  key: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  value: {
    type: DataTypes.JSON,
    allowNull: false,
  },
}, {
  sequelize,
  modelName: 'Setting',
  tableName: 'settings',
});

export default Setting;

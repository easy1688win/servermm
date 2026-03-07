import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

class Game extends Model {
  public id!: number;
  public name!: string;
  public icon!: string | null;
  public balance!: number;
  public status!: 'active' | 'inactive';
}

Game.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  icon: {
    type: DataTypes.TEXT('medium'),
    allowNull: true,
  },
  balance: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active',
  },
}, {
  sequelize,
  modelName: 'Game',
  tableName: 'games',
});

export default Game;

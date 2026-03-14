import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

if (!DB_NAME || !DB_USER) {
  throw new Error('Database configuration missing');
}

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  dialect: 'mysql',
  port: Number(DB_PORT) || 3306,
  logging: false,
  timezone: '+08:00', // Default timezone to GMT+8
  dialectOptions: {
    dateStrings: true,
    typeCast: true,
  },
});

export default sequelize;

import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT, DB_SOCKET_PATH } = process.env;

if (!DB_NAME || !DB_USER) {
  throw new Error('Database configuration missing');
}

// Use Unix Socket if available (ECS deployment), otherwise TCP
const sequelize = DB_SOCKET_PATH
  ? new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
      dialect: 'mysql',
      logging: false,
      timezone: '+08:00',
      dialectOptions: {
        socketPath: DB_SOCKET_PATH,
        dateStrings: true,
        typeCast: true,
      },
    })
  : new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
      host: DB_HOST,
      dialect: 'mysql',
      port: Number(DB_PORT) || 3306,
      logging: false,
      timezone: '+08:00',
      dialectOptions: {
        dateStrings: true,
        typeCast: true,
      },
    });

export default sequelize;

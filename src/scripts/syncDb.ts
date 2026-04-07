import dotenv from 'dotenv';
import sequelize from '../config/database';
import '../models';

dotenv.config();

async function syncDb() {
  try {
    const sqlLogs: string[] = [];
    const logging = (sql: string) => {
      const line = typeof sql === 'string' ? sql.trim() : '';
      if (!line) return;
      sqlLogs.push(line);
    };

    console.log('⏳ Testing database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connected successfully.\n');

    console.log('⏳ Syncing database tables...');
    await sequelize.sync({ alter: true, logging });
    console.log('✅ Database tables synced.\n');

    const schemaStatements = sqlLogs.filter((s) => /^(CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i.test(s));
    if (schemaStatements.length === 0) {
      console.log('ℹ️  Schema changes: none');
    } else {
      console.log(`🔧 Schema changes: ${schemaStatements.length}`);
      for (const stmt of schemaStatements) {
        console.log(stmt);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

syncDb();

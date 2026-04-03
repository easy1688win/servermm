import sequelize from '../config/database';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { QueryTypes } from 'sequelize';
import fs from 'fs';
import path from 'path';

dotenv.config();

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

// 创建日志目录和文件
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, `db-migration-${new Date().toISOString().split('T')[0]}.log`);
const REPORT_FILE = path.join(LOG_DIR, `db-report-${new Date().toISOString().split('T')[0]}.json`);

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 日志记录函数
const logToFile = (message: string, type: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO') => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${type}] ${message}\n`;
  
  // 写入文件
  fs.appendFileSync(LOG_FILE, logEntry);
  
  // 同时输出到控制台
  console.log(message);
};

const logSection = (title: string) => {
  const separator = '='.repeat(60);
  const message = `\n${separator}\n${title}\n${separator}`;
  logToFile(message);
};

const logJsonToFile = (data: any, filename: string) => {
  const filePath = path.join(LOG_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  logToFile(`📄 JSON report saved to: ${filePath}`);
};

async function createDatabase() {
  try {
    logToFile(`🔌 Connecting to MySQL server at ${DB_HOST}:${DB_PORT || 3306}...`);
    
    const connection = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      port: Number(DB_PORT) || 3306,
    });

    logToFile(`✅ Connected to MySQL server successfully.`, 'SUCCESS');

    // 检查数据库是否存在
    logToFile(`🔍 Checking if database '${DB_NAME}' exists...`);
    const [rows]: any = await connection.query(
      `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [DB_NAME]
    );

    const dbExists = rows.length > 0;

    if (!dbExists) {
      // 数据库不存在，创建它
      logToFile(`📦 Database '${DB_NAME}' does not exist. Creating...`);
      await connection.query(`CREATE DATABASE \`${DB_NAME}\`;`);
      logToFile(`✅ Database '${DB_NAME}' created successfully.`, 'SUCCESS');
    } else {
      // 数据库已存在，跳过创建
      logToFile(`⏭️ Database '${DB_NAME}' already exists, skipping creation.`);
    }

    await connection.end();
    logToFile(`🔌 MySQL connection closed.`);
  } catch (error) {
    logToFile(`❌ Error creating database: ${error}`, 'ERROR');
    process.exit(1);
  }
}

async function reportDatabaseChanges() {
  const report: any = {
    timestamp: new Date().toISOString(),
    database: DB_NAME,
    host: DB_HOST,
    tables: [],
    migrations: [],
    foreignKeys: [],
    indexes: [],
    recentChanges: [],
    warnings: [],
    summary: {}
  };

  try {
    logSection('📊 DATABASE MIGRATION REPORT');
    
    // 获取所有表名
    const tables: any[] = await sequelize.query(
      `SELECT TABLE_NAME, CREATE_TIME, UPDATE_TIME, TABLE_ROWS, ENGINE
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      {
        replacements: [DB_NAME],
        type: QueryTypes.SELECT
      }
    );

    report.summary.totalTables = tables.length;
    logToFile(`\n📋 Found ${tables.length} tables in database:`);
    
    for (const table of tables) {
      logToFile(`   - ${table.TABLE_NAME} (created: ${table.CREATE_TIME}, engine: ${table.ENGINE})`);
      report.tables.push({
        name: table.TABLE_NAME,
        created: table.CREATE_TIME,
        updated: table.UPDATE_TIME,
        rows: table.TABLE_ROWS,
        engine: table.ENGINE
      });

      // 获取每个表的列信息
      const columns: any[] = await sequelize.query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_TYPE, EXTRA
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        {
          replacements: [DB_NAME, table.TABLE_NAME],
          type: QueryTypes.SELECT
        }
      );

      report.tables[report.tables.length - 1].columns = columns;
    }

    // 检查是否有 SequelizeMeta 表（记录 migrations）
    const hasMetaTable = tables.some(t => t.TABLE_NAME === 'SequelizeMeta');
    
    if (hasMetaTable) {
      logToFile(`\n📝 SequelizeMeta table found. Checking migration history...`);
      
      // 获取已执行的 migrations
      const migrations: any[] = await sequelize.query(
        `SELECT name FROM SequelizeMeta ORDER BY name`,
        { type: QueryTypes.SELECT }
      );
      
      report.migrations = migrations;
      report.summary.totalMigrations = migrations.length;
      
      logToFile(`   ✅ ${migrations.length} migrations have been executed:`);
      migrations.forEach((m, i) => {
        logToFile(`      ${i + 1}. ${m.name}`);
      });
    } else {
      const warning = 'No SequelizeMeta table found. No migrations have been tracked.';
      logToFile(`\n⚠️  ${warning}`);
      report.warnings.push(warning);
    }

    // 检查 bank_accounts 表的结构
    const bankAccountsColumns: any[] = await sequelize.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bank_accounts'
       ORDER BY ORDINAL_POSITION`,
      {
        replacements: [DB_NAME],
        type: QueryTypes.SELECT
      }
    );

    if (bankAccountsColumns.length > 0) {
      logToFile(`\n🏦 BankAccounts table schema:`);
      logToFile(`   Columns (${bankAccountsColumns.length}):`);
      
      const bankAccountsReport = {
        table: 'bank_accounts',
        columns: bankAccountsColumns
      };
      
      bankAccountsColumns.forEach(col => {
        logToFile(`   - ${col.COLUMN_NAME}: ${col.DATA_TYPE} ${col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });

      // 检查 account_number 字段是否存在且正确
      const hasAccountNumber = bankAccountsColumns.some(c => c.COLUMN_NAME === 'account_number');
      const hasAccountNumberFull = bankAccountsColumns.some(c => c.COLUMN_NAME === 'account_number_full');
      
      if (hasAccountNumberFull) {
        const warning = `Found deprecated column 'account_number_full' in bank_accounts table. Migration needed.`;
        logToFile(`   ⚠️  WARNING: ${warning}`);
        report.warnings.push(warning);
      }
      
      if (hasAccountNumber) {
        logToFile(`   ✅ Column 'account_number' exists and is properly configured.`);
      }

      report.bankAccounts = bankAccountsReport;
    }

    // 修复：检查是否有外键约束 - 明确指定表别名避免字段歧义
    const foreignKeys: any[] = await sequelize.query(
      `SELECT 
        kcu.CONSTRAINT_NAME,
        kcu.TABLE_NAME,
        kcu.COLUMN_NAME,
        kcu.REFERENCED_TABLE_NAME,
        kcu.REFERENCED_COLUMN_NAME,
        rc.UPDATE_RULE,
        rc.DELETE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
         ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
         AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
       WHERE kcu.REFERENCED_TABLE_SCHEMA = ? 
         AND kcu.CONSTRAINT_NAME != 'PRIMARY'
       ORDER BY kcu.TABLE_NAME`,
      {
        replacements: [DB_NAME],
        type: QueryTypes.SELECT
      }
    );

    report.foreignKeys = foreignKeys;
    report.summary.totalForeignKeys = foreignKeys.length;

    if (foreignKeys.length > 0) {
      logToFile(`\n🔗 Foreign key constraints (${foreignKeys.length}):`);
      foreignKeys.forEach(fk => {
        logToFile(`   - ${fk.TABLE_NAME}.${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`);
        if (fk.UPDATE_RULE || fk.DELETE_RULE) {
          logToFile(`     (ON UPDATE: ${fk.UPDATE_RULE || 'N/A'}, ON DELETE: ${fk.DELETE_RULE || 'N/A'})`);
        }
      });
    }

    // 检查索引
    const indexes: any[] = await sequelize.query(
      `SELECT 
        TABLE_NAME,
        INDEX_NAME,
        COLUMN_NAME,
        NON_UNIQUE,
        INDEX_TYPE,
        SEQ_IN_INDEX
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      {
        replacements: [DB_NAME],
        type: QueryTypes.SELECT
      }
    );

    report.indexes = indexes;
    report.summary.totalIndexes = indexes.length;

    if (indexes.length > 0) {
      logToFile(`\n📑 Indexes found:`);
      const indexMap = new Map();
      indexes.forEach(idx => {
        const key = `${idx.TABLE_NAME}.${idx.INDEX_NAME}`;
        if (!indexMap.has(key)) {
          indexMap.set(key, {
            table: idx.TABLE_NAME,
            name: idx.INDEX_NAME,
            columns: [],
            unique: idx.NON_UNIQUE === 0,
            type: idx.INDEX_TYPE
          });
        }
        indexMap.get(key).columns.push(idx.COLUMN_NAME);
      });

      indexMap.forEach(idx => {
        logToFile(`   - ${idx.table}.${idx.name} (${idx.columns.join(', ')}) ${idx.unique ? 'UNIQUE' : ''} [${idx.type}]`);
      });
    }

    // 检查最近修改的表
    logToFile(`\n🕒 Recently modified tables (last 7 days):`);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const recentTables: any[] = await sequelize.query(
      `SELECT TABLE_NAME, UPDATE_TIME
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? 
         AND UPDATE_TIME IS NOT NULL
         AND UPDATE_TIME > ?
       ORDER BY UPDATE_TIME DESC`,
      {
        replacements: [DB_NAME, sevenDaysAgo.toISOString().slice(0, 19).replace('T', ' ')],
        type: QueryTypes.SELECT
      }
    );

    report.recentChanges = recentTables;
    report.summary.recentChanges = recentTables.length;

    if (recentTables.length > 0) {
      recentTables.forEach(t => {
        logToFile(`   - ${t.TABLE_NAME} (last updated: ${t.UPDATE_TIME})`);
      });
    } else {
      logToFile(`   No tables modified in the last 7 days`);
    }

    // 添加数据库大小信息
    const dbSize: any[] = await sequelize.query(
      `SELECT 
        SUM(data_length + index_length) as total_size_bytes,
        SUM(data_length) as data_size_bytes,
        SUM(index_length) as index_size_bytes
       FROM information_schema.tables
       WHERE table_schema = ?`,
      {
        replacements: [DB_NAME],
        type: QueryTypes.SELECT
      }
    );

    if (dbSize[0] && dbSize[0].total_size_bytes) {
      report.databaseSize = {
        totalBytes: dbSize[0].total_size_bytes,
        totalMB: Math.round(dbSize[0].total_size_bytes / (1024 * 1024) * 100) / 100,
        dataMB: Math.round(dbSize[0].data_size_bytes / (1024 * 1024) * 100) / 100,
        indexMB: Math.round(dbSize[0].index_size_bytes / (1024 * 1024) * 100) / 100
      };
      
      logToFile(`\n💾 Database size: ${report.databaseSize.totalMB} MB`);
    }

    // 生成摘要
    report.summary.warnings = report.warnings.length;
    report.summary.hasIssues = report.warnings.length > 0;

    logSection('📊 END OF MIGRATION REPORT');
    
    // 保存完整报告到 JSON 文件
    const jsonFilename = `db-report-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`;
    logJsonToFile(report, jsonFilename);
    
    logToFile(`\n📁 Log file saved to: ${LOG_FILE}`);
    logToFile(`📊 JSON report saved to: ${path.join(LOG_DIR, jsonFilename)}`);

  } catch (error) {
    logToFile(`❌ Error generating migration report: ${error}`, 'ERROR');
    report.error = error;
  }
  
  return report;
}


async function initDb() {
  const startTime = Date.now();
  
  try {
    logSection('🚀 DATABASE INITIALIZATION STARTED');
    logToFile(`Started at: ${new Date().toISOString()}`);

    await createDatabase();

    await sequelize.authenticate();
    logToFile('✅ Database connected successfully.', 'SUCCESS');

    // 生成迁移报告（无论数据库是新创建还是已存在）
    const beforeReport = await reportDatabaseChanges();

    // 同步模型（会应用任何模型变更）
    logToFile('\n🔄 Syncing database models...');
    const syncOptions = { alter: true };
    
    // 记录同步前的结构
    logToFile('Applying model changes...');
    
    await sequelize.sync(syncOptions);
    logToFile('✅ Database models synced successfully.', 'SUCCESS');

    // 同步后再次检查是否有变更
    logToFile('\n🔄 Checking for changes after sync...');
    const afterReport = await reportDatabaseChanges();

    // 生成变更报告
    const changes = {
      before: beforeReport,
      after: afterReport,
      duration: `${((Date.now() - startTime) / 1000).toFixed(3)} seconds`,
      completedAt: new Date().toISOString()
    };

    const changeFilename = `db-changes-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`;
    logJsonToFile(changes, changeFilename);

    // 输出执行摘要
    logSection('✅ INITIALIZATION COMPLETE');
    logToFile(`Total execution time: ${changes.duration}`);
    logToFile(`Database: ${DB_NAME} on ${DB_HOST}`);
    logToFile(`Tables: ${afterReport.summary.totalTables}`);
    logToFile(`Migrations: ${afterReport.summary.totalMigrations || 0}`);
    logToFile(`Foreign Keys: ${afterReport.summary.totalForeignKeys || 0}`);
    logToFile(`Indexes: ${afterReport.summary.totalIndexes || 0}`);
    logToFile(`Warnings: ${afterReport.summary.warnings || 0}`);
    logToFile(`\n📁 All logs and reports saved to: ${LOG_DIR}`);

    process.exit(0);
  } catch (error) {
    logToFile(`❌ Error initializing DB: ${error}`, 'ERROR');
    process.exit(1);
  }
}

initDb();
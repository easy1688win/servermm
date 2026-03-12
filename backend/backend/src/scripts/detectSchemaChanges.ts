import sequelize from '../config/database';
import fs from 'fs';
import path from 'path';
import { Sequelize } from 'sequelize';
import chalk from 'chalk'; // 可选，用于彩色输出

// 需要检查的表清单（从 models/index.ts 自动获取，或手动定义）
const EXPECTED_TABLES = [
  'users',
  'permissions',
  'roles',
  'role_permissions',
  'user_roles',
  'user_permissions',
  'user_sessions',
  'user_device_locks',
  'players',
  'player_stats',
  'games',
  'game_adjustments',
  'bank_accounts',
  'bank_catalog',
  'transactions',
  'audit_logs',
  'settings',
];

// 从模型文件中提取字段定义（简化版，实际可以从 Sequelize 模型获取）
interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: any;
  key: string;
}

interface TableChanges {
  missingColumns: string[];
  extraColumns: string[];
  typeMismatches: Array<{column: string, dbType: string, expectedType: string}>;
  nullableMismatches: Array<{column: string, dbNullable: boolean, expectedNullable: boolean}>;
  defaultMismatches: Array<{column: string, dbDefault: any, expectedDefault: any}>;
}

interface Changes {
  missingTables: string[];
  extraTables: string[];
  tableChanges: Record<string, TableChanges>;
}

async function getCurrentSchema() {
  const [tables] = await sequelize.query(`
    SELECT 
      TABLE_NAME,
      COLUMN_NAME,
      DATA_TYPE,
      COLUMN_TYPE,
      IS_NULLABLE,
      COLUMN_DEFAULT,
      COLUMN_KEY,
      EXTRA
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  const schema: Record<string, ColumnInfo[]> = {};
  
  for (const row of tables as any[]) {
    if (!schema[row.TABLE_NAME]) {
      schema[row.TABLE_NAME] = [];
    }
    
    schema[row.TABLE_NAME].push({
      name: row.COLUMN_NAME,
      type: row.COLUMN_TYPE,
      nullable: row.IS_NULLABLE === 'YES',
      default: row.COLUMN_DEFAULT,
      key: row.COLUMN_KEY,
    });
  }
  
  return schema;
}

async function getExpectedSchema() {
  // 从 Sequelize 模型获取预期结构
  const expected: Record<string, any> = {};
  
  // 这里需要导入所有模型
  const models = await import('../models');
  
  for (const tableName of EXPECTED_TABLES) {
    // 找到对应的模型
    const modelName = Object.keys(models).find(
      (key: string) => (models as any)[key].tableName === tableName
    );
    
    if (modelName) {
      const model = (models as any)[modelName];
      const attributes = model.getAttributes();
      
      expected[tableName] = {
        columns: Object.entries(attributes).map(([name, attr]: [string, any]) => {
          let type = 'UNKNOWN';
          try {
            if (attr.type && attr.type.toSql) {
              type = attr.type.toSql();
            }
          } catch (error) {
            console.warn(`Warning: Could not get SQL type for ${tableName}.${name}: ${error}`);
            // Fallback to basic type detection
            if (attr.type && attr.type.key) {
              type = attr.type.key;
            }
          }
          
          return {
            name,
            type,
            nullable: !attr.allowNull,
            default: attr.defaultValue,
            primaryKey: attr.primaryKey,
          };
        }),
        indexes: [], // 可以从模型获取索引
      };
    }
  }
  
  return expected;
}

function compareTypes(dbType: string, modelType: string): boolean {
  // 规范化类型进行比较
  const normalizeType = (type: string) => {
    return type
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/\(\d+\)/g, '') // 忽略长度参数
      .replace(/unsigned/g, '')
      .trim();
  };
  
  return normalizeType(dbType) === normalizeType(modelType);
}

function detectChanges(current: Record<string, any>, expected: Record<string, any>) {
  const changes = {
    missingTables: [] as string[],
    extraTables: [] as string[],
    tableChanges: {} as Record<string, {
      missingColumns: string[];
      extraColumns: string[];
      typeMismatches: Array<{column: string, dbType: string, expectedType: string}>;
      nullableMismatches: Array<{column: string, dbNullable: boolean, expectedNullable: boolean}>;
      defaultMismatches: Array<{column: string, dbDefault: any, expectedDefault: any}>;
    }>,
  };

  // 检查缺失的表
  for (const table of EXPECTED_TABLES) {
    if (!current[table]) {
      changes.missingTables.push(table);
    }
  }

  // 检查多余的表（不在期望中，但存在于数据库）
  for (const table of Object.keys(current)) {
    if (!EXPECTED_TABLES.includes(table) && 
        !table.startsWith('Sequelize') && // 忽略 Sequelize 系统表
        !['migrations', 'sequelizemeta'].includes(table.toLowerCase())) {
      changes.extraTables.push(table);
    }
  }

  // 检查每个表的字段
  for (const table of EXPECTED_TABLES) {
    if (!current[table]) continue;
    
    const currentCols = current[table];
    const expectedCols = expected[table]?.columns || [];
    
    const tableChanges: TableChanges = {
      missingColumns: [],
      extraColumns: [],
      typeMismatches: [],
      nullableMismatches: [],
      defaultMismatches: [],
    };

    // 创建快速查找映射
    const currentMap = new Map(currentCols.map((c: ColumnInfo) => [c.name, c]));
    const expectedMap = new Map(expectedCols.map((c: any) => [c.name, c]));

    // 检查缺失的字段
    for (const [name, expectedCol] of expectedMap) {
      if (!currentMap.has(name as string)) {
        tableChanges.missingColumns.push(name as string);
      }
    }

    // 检查多余的字段
    for (const [name, currentCol] of currentMap) {
      if (!expectedMap.has(name)) {
        // 检查是否可能是自动生成的字段
        if (!['id', 'createdAt', 'updatedAt', 'created_at', 'updated_at'].includes(name as string)) {
          tableChanges.extraColumns.push(name as string);
        }
      }
    }

    // 检查类型不匹配
    for (const [name, expectedCol] of expectedMap) {
      const currentCol = currentMap.get(name);
      if (currentCol && expectedCol) {
        const expected = expectedCol as any;
        const current = currentCol as any;
        if (!compareTypes(current.type, expected.type)) {
          tableChanges.typeMismatches.push({
            column: name as string,
            dbType: current.type,
            expectedType: expected.type,
          });
        }
        
        // 检查 NULL 约束
        if (current.nullable !== expected.nullable) {
          tableChanges.nullableMismatches.push({
            column: name as string,
            dbNullable: current.nullable,
            expectedNullable: expected.nullable,
          });
        }
        
        // 检查默认值（TODO: 需要更智能的比较）
        if (JSON.stringify(current.default) !== JSON.stringify(expected.default)) {
          tableChanges.defaultMismatches.push({
            column: name as string,
            dbDefault: current.default,
            expectedDefault: expected.default,
          });
        }
      }
    }

    if (Object.values(tableChanges).some(arr => arr.length > 0)) {
      changes.tableChanges[table] = tableChanges;
    }
  }

  return changes;
}

function printReport(changes: Changes) {
  console.log('\n' + '='.repeat(60));
  console.log(chalk.bold.blue('📊 数据库结构检测报告'));
  console.log('='.repeat(60));

  // 缺失的表
  if (changes.missingTables.length > 0) {
    console.log(chalk.bold.red('\n❌ 缺失的表:'));
    changes.missingTables.forEach((table: string) => {
      console.log(chalk.red(`   - ${table}`));
    });
  }

  // 多余的表
  if (changes.extraTables.length > 0) {
    console.log(chalk.bold.yellow('\n⚠️ 多余的额外表:'));
    changes.extraTables.forEach((table: string) => {
      console.log(chalk.yellow(`   - ${table}`));
    });
  }

  // 表结构变更
  if (Object.keys(changes.tableChanges).length > 0) {
    console.log(chalk.bold.cyan('\n📋 表结构变更:'));
    
    for (const [table, tc] of Object.entries(changes.tableChanges)) {
      console.log(chalk.bold(`\n  ${table}:`));
      
      if (tc.missingColumns.length > 0) {
        console.log(chalk.red(`   缺失字段:`));
        tc.missingColumns.forEach((col: string) => console.log(chalk.red(`     - ${col}`)));
      }
      
      if (tc.extraColumns.length > 0) {
        console.log(chalk.yellow(`   多余字段:`));
        tc.extraColumns.forEach((col: string) => console.log(chalk.yellow(`     - ${col}`)));
      }
      
      if (tc.typeMismatches.length > 0) {
        console.log(chalk.magenta(`   类型不匹配:`));
        tc.typeMismatches.forEach((m: any) => 
          console.log(chalk.magenta(`     - ${m.column}: ${m.dbType} -> ${m.expectedType}`))
        );
      }
      
      if (tc.nullableMismatches.length > 0) {
        console.log(chalk.blue(`   NULL约束不匹配:`));
        tc.nullableMismatches.forEach((m: any) => 
          console.log(chalk.blue(`     - ${m.column}: ${m.dbNullable ? 'NULL' : 'NOT NULL'} -> ${m.expectedNullable ? 'NULL' : 'NOT NULL'}`))
        );
      }
      
      if (tc.defaultMismatches.length > 0) {
        console.log(chalk.gray(`   默认值不匹配:`));
        tc.defaultMismatches.forEach((m: any) => 
          console.log(chalk.gray(`     - ${m.column}: ${m.dbDefault} -> ${m.expectedDefault}`))
        );
      }
    }
  }

  // 统计摘要
  console.log(chalk.bold.green('\n📈 统计摘要:'));
  console.log(`   缺失表: ${chalk.red(changes.missingTables.length)}`);
  console.log(`   额外表: ${chalk.yellow(changes.extraTables.length)}`);
  console.log(`   需要变更的表: ${chalk.cyan(Object.keys(changes.tableChanges).length)}`);

  console.log('\n' + '='.repeat(60));
  
  if (Object.keys(changes.tableChanges).length > 0 || changes.missingTables.length > 0) {
    console.log(chalk.yellow('\n⚠️  检测到结构变更，建议运行同步脚本'));
  } else {
    console.log(chalk.green('\n✅ 数据库结构与模型一致，无需变更'));
  }
}

async function generateSql(changes: Changes): Promise<string> {
  const sql: string[] = [];
  
  // 生成创建表的 SQL
  for (const table of changes.missingTables) {
    sql.push(`-- TODO: 需要创建表 ${table}`);
    sql.push(`-- 请参考模型定义手动创建`);
  }
  
  // 生成添加字段的 SQL
  for (const [table, tc] of Object.entries(changes.tableChanges)) {
    if (tc.missingColumns.length > 0) {
      sql.push(`\n-- ${table} 添加字段:`);
      tc.missingColumns.forEach((col: string) => {
        sql.push(`-- ALTER TABLE ${table} ADD COLUMN ${col} ...;`);
      });
    }
    
    if (tc.typeMismatches.length > 0) {
      sql.push(`\n-- ${table} 修改字段类型:`);
      tc.typeMismatches.forEach((m: any) => {
        sql.push(`-- ALTER TABLE ${table} MODIFY COLUMN ${m.column} ${m.expectedType};`);
      });
    }
  }
  
  return sql.join('\n');
}

async function main() {
  try {
    console.log(chalk.blue('🔍 正在连接数据库...'));
    await sequelize.authenticate();
    console.log(chalk.green('✅ 数据库连接成功\n'));

    console.log(chalk.blue('📥 获取当前数据库结构...'));
    const currentSchema = await getCurrentSchema();
    
    console.log(chalk.blue('📤 获取模型预期结构...'));
    const expectedSchema = await getExpectedSchema();
    
    console.log(chalk.blue('🔎 检测变更...\n'));
    const changes = detectChanges(currentSchema, expectedSchema);
    
    printReport(changes);
    
    // 如果需要生成 SQL
    if (process.argv.includes('--sql')) {
      const sql = await generateSql(changes);
      console.log('\n' + chalk.bold.cyan('📝 建议执行的 SQL:'));
      console.log(sql);
    }
    
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('❌ 检测失败:'), error);
    process.exit(1);
  }
}

// 处理命令行参数
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
用法: ts-node detectSchemaChanges.ts [选项]

选项:
  --sql     生成建议执行的 SQL 语句
  --help    显示帮助信息
  `);
  process.exit(0);
}

main();
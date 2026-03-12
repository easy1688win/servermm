
import sequelize from '../config/database';

async function fixSchema() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');

    // Fix transactions table
    await sequelize.query('ALTER TABLE transactions MODIFY COLUMN player_id INT NULL;');
    console.log('transactions.player_id set to NULLABLE.');

    // Fix audit_logs table (add missing columns if they don't exist)
    try {
        await sequelize.query('ALTER TABLE audit_logs ADD COLUMN ip_address VARCHAR(255) NULL;');
        console.log('audit_logs.ip_address added.');
    } catch (e: any) {
        if (e.original && e.original.code === 'ER_DUP_FIELDNAME') {
            console.log('audit_logs.ip_address already exists.');
        } else {
            console.error('Error adding ip_address:', e);
        }
    }
    
    // Fix audit_logs.user_id to be NULLABLE
    try {
        await sequelize.query('ALTER TABLE audit_logs MODIFY COLUMN user_id INT NULL;');
        console.log('audit_logs.user_id set to NULLABLE.');
    } catch (e: any) {
        console.error('Error modifying user_id:', e);
    }

    // Add users.full_name column if missing
    try {
        await sequelize.query('ALTER TABLE users ADD COLUMN full_name VARCHAR(255) NULL;');
        console.log('users.full_name added.');
    } catch (e: any) {
        if (e.original && (e.original.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(e.original.message))) {
            console.log('users.full_name already exists.');
        } else {
            console.error('Error adding users.full_name:', e);
        }
    }

    // Add last_login_at and last_login_ip columns if missing
    try {
        await sequelize.query('ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL;');
        console.log('users.last_login_at added.');
    } catch (e: any) {
        if (e.original && (e.original.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(e.original.message))) {
            console.log('users.last_login_at already exists.');
        } else {
            console.error('Error adding users.last_login_at:', e);
        }
    }
    try {
        await sequelize.query('ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(255) NULL;');
        console.log('users.last_login_ip added.');
    } catch (e: any) {
        if (e.original && (e.original.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(e.original.message))) {
            console.log('users.last_login_ip already exists.');
        } else {
            console.error('Error adding users.last_login_ip:', e);
        }
    }

    // Migrate status enum safely: allow both, convert, then restrict
    try {
        await sequelize.query("ALTER TABLE users MODIFY COLUMN status ENUM('active','banned','locked') NOT NULL DEFAULT 'active';");
        console.log('users.status enum temporarily expanded.');
        await sequelize.query("UPDATE users SET status='locked' WHERE status='banned';");
        console.log('users.status values migrated from banned to locked.');
        await sequelize.query("ALTER TABLE users MODIFY COLUMN status ENUM('active','locked') NOT NULL DEFAULT 'active';");
        console.log('users.status enum finalized to active/locked.');
    } catch (e: any) {
        console.error('Error modifying users.status to locked:', e);
    }

    // Ensure games.icon can store base64 images
    try {
        await sequelize.query('ALTER TABLE games MODIFY COLUMN icon MEDIUMTEXT NULL;');
        console.log('games.icon modified to MEDIUMTEXT.');
    } catch (e: any) {
        console.error('Error modifying games.icon:', e);
    }

    // Ensure bank_catalog.icon can store base64 images
    try {
        await sequelize.query('ALTER TABLE bank_catalog MODIFY COLUMN icon MEDIUMTEXT NULL;');
        console.log('bank_catalog.icon modified to MEDIUMTEXT.');
    } catch (e: any) {
        console.error('Error modifying bank_catalog.icon:', e);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error fixing schema:', error);
    process.exit(1);
  }
}

fixSchema();

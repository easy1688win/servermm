
import sequelize from '../config/database';

async function fixAuditLogs() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');

    // The error "Incorrect datetime value: '0000-00-00 00:00:00' for column 'created_at' at row 1"
    // implies that there are rows in audit_logs, and we are trying to ADD created_at as NOT NULL, 
    // but the default or existing values are invalid.
    
    // First, check if created_at exists
    try {
        await sequelize.query("SELECT created_at FROM audit_logs LIMIT 1;");
        console.log("created_at column exists.");
    } catch (e: any) {
        console.log("created_at column likely missing or error checking:", e.message);
        
        // If missing, we need to add it with a default value OR allow null first
        // But Sequelize sync tries to add it as NOT NULL.
        // We can manually add it with a default value.
        await sequelize.query("ALTER TABLE audit_logs ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;");
        console.log("Added created_at with default CURRENT_TIMESTAMP.");
    }

    // Also check user_id/userId column mapping
    // If the table has userId but we want user_id, we might need to rename it or handle it.
    // The previous error "Unknown column 'userId'" in INSERT suggests the model was using userId, but DB didn't have it?
    // Let's just inspect columns.
    const [results] = await sequelize.query("DESCRIBE audit_logs;");
    console.log("audit_logs columns:", results);

    process.exit(0);
  } catch (error) {
    console.error('Error fixing audit_logs:', error);
    process.exit(1);
  }
}

fixAuditLogs();

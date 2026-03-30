# 🗄️ Production Database Backup Scripts

This directory contains production-ready database backup scripts compatible with both Windows and Linux systems.

## 📋 Files Overview

- `backup-database.sh` - Linux/macOS/WSL backup script
- `backup-database.bat` - Windows CMD backup script  
- `README-backup.md` - This documentation

## 🚀 Quick Start

### Linux/macOS/WSL
```bash
# Set required environment variables
export DB_NAME="lighthouse_ledger"
export DB_USER="postgres"
export DB_HOST="localhost"
export DB_PORT="5432"
export DB_PASSWORD="your_password"

# Optional variables
export BACKUP_DIR="./backups"
export MAX_BACKUPS="7"
export WEBHOOK_URL="https://hooks.slack.com/..."

# Make script executable
chmod +x backup-database.sh

# Run backup
./backup-database.sh
```

### Windows
```cmd
:: Set required environment variables
set DB_NAME=lighthouse_ledger
set DB_USER=postgres
set DB_HOST=localhost
set DB_PORT=5432
set DB_PASSWORD=your_password

:: Optional variables
set BACKUP_DIR=.\backups
set MAX_BACKUPS=7
set WEBHOOK_URL=https://hooks.slack.com/...

:: Run backup script
backup-database.bat
```

## ⚙️ Configuration

### Environment Variables

**Required Variables (No Defaults):**
| Variable | Description | Example |
|----------|-------------|---------|
| `DB_NAME` | Database name | `lighthouse_ledger` |
| `DB_USER` | Database username | `postgres` |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_PASSWORD` | Database password | `your_password` |

**Optional Variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_DIR` | `./backups` | Backup directory |
| `MAX_BACKUPS` | `7` | Days to keep backups |
| `WEBHOOK_URL` | *none* | Optional notification webhook |

### Script Configuration

You can modify the configuration variables at the top of each script:

```bash
# Example for backup-database.sh
DB_NAME="your_database"
DB_USER="your_user"
DB_HOST="your_host"
BACKUP_DIR="./backups"
MAX_BACKUPS=14  # Keep 2 weeks of backups
```

## 📁 Backup Structure

```
backups/
├── backup_20240330_143022.sql.gz    # Compressed backup
├── backup_20240329_143022.sql.gz    # Previous backup
├── backup.log                       # Backup log file
└── ...                              # Other backups
```

## 🔧 Features

### ✅ Built-in Features

- **Cross-platform**: Works on Windows, Linux, macOS
- **Compression**: Automatic backup compression (.gz or .7z)
- **Cleanup**: Automatic old backup cleanup
- **Verification**: Backup integrity verification
- **Logging**: Detailed logging with timestamps
- **Notifications**: Optional webhook notifications
- **Security**: Password prompt or environment variable
- **Error Handling**: Comprehensive error checking

### 🛡️ Security Features

- Password input hidden (no echo)
- Database connection verification
- Backup integrity verification
- Secure file permissions
- No hardcoded passwords

## 📊 Backup Options

### Backup Format
- **Format**: PostgreSQL custom format
- **Options**: 
  - `--clean`: Include DROP statements
  - `--no-owner`: Exclude ownership commands
  - `--no-privileges`: Exclude access privilege commands
  - `--verbose`: Detailed output

### Compression
- **Linux/macOS**: gzip compression
- **Windows**: 7-Zip (preferred) or gzip

## 🔄 Automation

### Cron Job (Linux/macOS)
```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/backup-database.sh

# Add weekly backup on Sunday at 3 AM
0 3 * * 0 /path/to/backup-database.sh
```

### Windows Task Scheduler
1. Open Task Scheduler
2. Create Basic Task
3. Set trigger (daily/weekly)
4. Action: Start a program
5. Program: `C:\path\to\backup-database.bat`
6. Set conditions and settings

### Systemd Service (Linux)
```ini
# /etc/systemd/system/backup-db.service
[Unit]
Description=Database Backup Service
After=postgresql.service

[Service]
Type=oneshot
User=postgres
ExecStart=/path/to/backup-database.sh
Environment=DB_PASSWORD=your_password

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/backup-db.timer
[Unit]
Description=Run database backup daily
Requires=backup-db.service

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

## 📱 Notifications

### Slack Webhook
```bash
export WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
```

### Discord Webhook
```bash
export WEBHOOK_URL="https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK"
```

### Custom Notification
Modify the `send_notification()` function in the scripts to add email, SMS, or other notification methods.

## 🚨 Troubleshooting

### Common Issues

#### 1. "PostgreSQL client not found"
**Solution**: Install PostgreSQL client tools
```bash
# Ubuntu/Debian
sudo apt-get install postgresql-client

# CentOS/RHEL
sudo yum install postgresql

# Windows
# Download from: https://www.postgresql.org/download/windows/
```

#### 2. "Failed to connect to database"
**Solutions**:
- Check database server is running
- Verify connection parameters
- Check firewall settings
- Ensure user has proper permissions

#### 3. "Permission denied"
**Solutions**:
- Run with appropriate user permissions
- Check backup directory permissions
- Ensure database user has backup privileges

#### 4. "Compression failed"
**Solutions**:
- Install 7-Zip on Windows
- Install gzip on Linux/macOS
- Check available disk space

### Debug Mode

Enable verbose output by modifying the script:
```bash
# Add to backup-database.sh
set -x  # Enable debug mode
```

### Log Analysis

Check the backup log for detailed information:
```bash
tail -f backups/backup.log
```

## 📋 Requirements

### System Requirements
- **Disk Space**: At least 2x database size for backups
- **Memory**: Minimum 512MB available
- **Network**: Connection to database server

### Software Requirements
- **PostgreSQL Client**: pg_dump and psql
- **Compression**: gzip (Linux/macOS) or 7-Zip (Windows)
- **Optional**: curl for notifications

### Database Permissions
The backup user needs:
- `CONNECT` privilege on the database
- `SELECT` privilege on all tables
- `USAGE` privilege on all schemas

```sql
-- Grant necessary permissions
GRANT CONNECT ON DATABASE lighthouse_ledger TO backup_user;
GRANT USAGE ON SCHEMA public TO backup_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_user;
```

## 🔄 Restoration

### From Custom Format Backup
```bash
# Restore from compressed backup
gunzip -c backup_20240330_143022.sql.gz | pg_restore -h localhost -U postgres -d lighthouse_ledger

# Or restore directly
pg_restore -h localhost -U postgres -d lighthouse_ledger backup_20240330_143022.sql.gz
```

### From SQL Dump
```bash
# If using plain SQL format
psql -h localhost -U postgres -d lighthouse_ledger < backup_20240330_143022.sql
```

## 📞 Support

For issues or questions:
1. Check the log file: `backups/backup.log`
2. Verify database connectivity
3. Check system requirements
4. Review troubleshooting section

## 📝 License

This backup script is provided as-is for production use. Test thoroughly in your environment before deploying to production.

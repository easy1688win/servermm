#!/bin/bash

# =============================================================================
# Production Database Backup Script
# Compatible with Linux and Windows (via Git Bash/WSL)
# =============================================================================

set -e  # Exit on any error

# Configuration - Use environment variables only
DB_NAME="${DB_NAME}"
DB_USER="${DB_USER}"
DB_HOST="${DB_HOST}"
DB_PORT="${DB_PORT}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql"
COMPRESSED_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"
MAX_BACKUPS="${MAX_BACKUPS:-7}"  # Keep last 7 days of backups by default

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

# Check required environment variables
check_required_env() {
    local missing_vars=()
    
    if [ -z "$DB_NAME" ]; then
        missing_vars+=("DB_NAME")
    fi
    
    if [ -z "$DB_USER" ]; then
        missing_vars+=("DB_USER")
    fi
    
    if [ -z "$DB_HOST" ]; then
        missing_vars+=("DB_HOST")
    fi
    
    if [ -z "$DB_PORT" ]; then
        missing_vars+=("DB_PORT")
    fi
    
    if [ ${#missing_vars[@]} -gt 0 ]; then
        print_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        echo ""
        echo "Please set the following environment variables:"
        echo "  export DB_NAME=\"your_database_name\""
        echo "  export DB_USER=\"your_database_user\""
        echo "  export DB_HOST=\"your_database_host\""
        echo "  export DB_PORT=\"your_database_port\""
        echo "  export DB_PASSWORD=\"your_database_password\""
        echo ""
        echo "Optional variables:"
        echo "  export BACKUP_DIR=\"./backups\""
        echo "  export MAX_BACKUPS=\"7\""
        echo "  export WEBHOOK_URL=\"https://hooks.slack.com/...\""
        exit 1
    fi
}

# Check if PostgreSQL is installed
check_postgresql() {
    if command -v psql &> /dev/null; then
        print_status "PostgreSQL client found"
    else
        print_error "PostgreSQL client not found. Please install PostgreSQL client tools."
        exit 1
    fi
}

# Create backup directory
create_backup_dir() {
    if [ ! -d "$BACKUP_DIR" ]; then
        mkdir -p "$BACKUP_DIR"
        print_status "Created backup directory: $BACKUP_DIR"
    fi
}

# Get database connection info from environment or prompt
get_db_credentials() {
    if [ -z "$DB_PASSWORD" ]; then
        echo -n "Enter database password for user '$DB_USER': "
        read -s DB_PASSWORD
        echo
    fi
    
    # Test database connection
    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &> /dev/null; then
        print_success "Database connection successful"
    else
        print_error "Failed to connect to database. Please check your credentials."
        exit 1
    fi
}

# Create database backup
create_backup() {
    print_status "Starting database backup..."
    print_status "Backup file: $BACKUP_FILE"
    
    # Create SQL backup
    if PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        --verbose --clean --no-owner --no-privileges --format=custom \
        --file="$BACKUP_FILE" 2>&1 | tee -a "$LOG_FILE"; then
        
        print_success "Database backup completed successfully"
        
        # Compress the backup
        print_status "Compressing backup file..."
        if gzip -c "$BACKUP_FILE" > "$COMPRESSED_FILE"; then
            print_success "Backup compressed successfully"
            print_status "Compressed file: $COMPRESSED_FILE"
            
            # Get file size
            FILE_SIZE=$(du -h "$COMPRESSED_FILE" | cut -f1)
            print_status "Backup size: $FILE_SIZE"
            
            # Remove uncompressed file
            rm "$BACKUP_FILE"
        else
            print_warning "Failed to compress backup file"
        fi
    else
        print_error "Database backup failed"
        exit 1
    fi
}

# Clean old backups
cleanup_old_backups() {
    print_status "Cleaning up old backups (keeping last $MAX_BACKUPS days)..."
    
    # Remove old compressed backups
    find "$BACKUP_DIR" -name "backup_*.sql.gz" -type f -mtime +$MAX_BACKUPS -delete 2>/dev/null || true
    
    # Remove old log files (keep 30 days)
    find "$BACKUP_DIR" -name "*.log" -type f -mtime +30 -delete 2>/dev/null || true
    
    # Count remaining backups
    BACKUP_COUNT=$(find "$BACKUP_DIR" -name "backup_*.sql.gz" -type f | wc -l)
    print_status "Remaining backups: $BACKUP_COUNT"
}

# Verify backup integrity
verify_backup() {
    if [ -f "$COMPRESSED_FILE" ]; then
        print_status "Verifying backup integrity..."
        
        # Test if the compressed file is valid
        if gzip -t "$COMPRESSED_FILE" 2>/dev/null; then
            print_success "Backup integrity verified"
        else
            print_error "Backup integrity check failed"
            exit 1
        fi
    else
        print_error "Backup file not found"
        exit 1
    fi
}

# Send notification (optional)
send_notification() {
    # You can customize this section to send email, Slack notification, etc.
    if command -v curl &> /dev/null && [ -n "$WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🗄️ Database backup completed successfully for $DB_NAME at $(date)\"}" \
            "$WEBHOOK_URL" 2>/dev/null || true
    fi
}

# Main execution
main() {
    echo "=========================================="
    echo "🗄️  Production Database Backup Script"
    echo "=========================================="
    echo "Database: $DB_NAME"
    echo "Host: $DB_HOST:$DB_PORT"
    echo "Backup Directory: $BACKUP_DIR"
    echo "=========================================="
    
    log "Starting database backup process"
    
    # Execute backup steps
    check_required_env
    check_postgresql
    create_backup_dir
    get_db_credentials
    create_backup
    verify_backup
    cleanup_old_backups
    send_notification
    
    echo "=========================================="
    print_success "Backup process completed successfully!"
    echo "Backup file: $COMPRESSED_FILE"
    echo "Log file: $LOG_FILE"
    echo "=========================================="
    
    log "Backup process completed successfully"
}

# Handle script interruption
trap 'print_error "Backup interrupted by user"; exit 1' INT TERM

# Run main function
main "$@"

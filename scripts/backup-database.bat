@echo off
:: =============================================================================
:: Production Database Backup Script (Windows)
:: Compatible with Windows CMD and PowerShell
:: =============================================================================

setlocal enabledelayedexpansion

:: Configuration - Use environment variables only
set DB_NAME=%DB_NAME%
set DB_USER=%DB_USER%
set DB_HOST=%DB_HOST%
set DB_PORT=%DB_PORT%
set BACKUP_DIR=%BACKUP_DIR%\nif "%BACKUP_DIR%"=="" set BACKUP_DIR=.\backups
set TIMESTAMP=%date:~-4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
set BACKUP_FILE=%BACKUP_DIR%\backup_%TIMESTAMP%.sql
set COMPRESSED_FILE=%BACKUP_DIR%\backup_%TIMESTAMP%.sql.gz
set LOG_FILE=%BACKUP_DIR%\backup.log
set MAX_BACKUPS=%MAX_BACKUPS%
if "%MAX_BACKUPS%"=="" set MAX_BACKUPS=7

:: Colors (Windows 10+)
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "NC=[0m"

:: Logging function
:log
echo [%date% %time%] %* >> "%LOG_FILE%"
goto :eof

:: Print functions
:print_status
echo %BLUE%[INFO]%NC% %*
echo [%date% %time%] [INFO] %* >> "%LOG_FILE%"
goto :eof

:print_success
echo %GREEN%[SUCCESS]%NC% %*
echo [%date% %time%] [SUCCESS] %* >> "%LOG_FILE%"
goto :eof

:print_warning
echo %YELLOW%[WARNING]%NC% %*
echo [%date% %time%] [WARNING] %* >> "%LOG_FILE%"
goto :eof

:print_error
echo %RED%[ERROR]%NC% %*
echo [%date% %time%] [ERROR] %* >> "%LOG_FILE%"
goto :eof

:: Check required environment variables
:check_required_env
set missing_vars=

if "%DB_NAME%"=="" (
    set missing_vars=!missing_vars! DB_NAME
)

if "%DB_USER%"=="" (
    set missing_vars=!missing_vars! DB_USER
)

if "%DB_HOST%"=="" (
    set missing_vars=!missing_vars! DB_HOST
)

if "%DB_PORT%"=="" (
    set missing_vars=!missing_vars! DB_PORT
)

if not "%missing_vars%"=="" (
    call :print_error "Missing required environment variables:"
    echo !missing_vars!
    echo.
    echo Please set the following environment variables:
    echo   set DB_NAME="your_database_name"
    echo   set DB_USER="your_database_user"
    echo   set DB_HOST="your_database_host"
    echo   set DB_PORT="your_database_port"
    echo   set DB_PASSWORD="your_database_password"
    echo.
    echo Optional variables:
    echo   set BACKUP_DIR=".\backups"
    echo   set MAX_BACKUPS="7"
    echo   set WEBHOOK_URL="https://hooks.slack.com/..."
    pause
    exit /b 1
)
goto :eof

:: Check if PostgreSQL is installed
:check_postgresql
pg_dump --version >nul 2>&1
if %errorlevel% neq 0 (
    call :print_error "PostgreSQL client not found. Please install PostgreSQL client tools."
    pause
    exit /b 1
)
call :print_status "PostgreSQL client found"
goto :eof

:: Create backup directory
:create_backup_dir
if not exist "%BACKUP_DIR%" (
    mkdir "%BACKUP_DIR%"
    call :print_status "Created backup directory: %BACKUP_DIR%"
)
goto :eof

:: Get database connection info
:get_db_credentials
if "%DB_PASSWORD%"=="" (
    set /p DB_PASSWORD="Enter database password for user '%DB_USER%': "
)

:: Test database connection
set PGPASSWORD=%DB_PASSWORD%
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "SELECT 1;" >nul 2>&1
if %errorlevel% neq 0 (
    call :print_error "Failed to connect to database. Please check your credentials."
    pause
    exit /b 1
)
call :print_success "Database connection successful"
goto :eof

:: Create database backup
:create_backup
call :print_status "Starting database backup..."
call :print_status "Backup file: %BACKUP_FILE%"

:: Create SQL backup
set PGPASSWORD=%DB_PASSWORD%
pg_dump -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% --verbose --clean --no-owner --no-privileges --format=custom --file="%BACKUP_FILE%" >> "%LOG_FILE%" 2>&1

if %errorlevel% neq 0 (
    call :print_error "Database backup failed"
    pause
    exit /b 1
)

call :print_success "Database backup completed successfully"

:: Compress the backup (requires 7-Zip or gzip)
call :print_status "Compressing backup file..."

:: Try 7-Zip first (more common on Windows)
if exist "C:\Program Files\7-Zip\7z.exe" (
    "C:\Program Files\7-Zip\7z.exe" a "%COMPRESSED_FILE%" "%BACKUP_FILE%" >nul 2>&1
) else if exist "C:\Program Files (x86)\7-Zip\7z.exe" (
    "C:\Program Files (x86)\7-Zip\7z.exe" a "%COMPRESSED_FILE%" "%BACKUP_FILE%" >nul 2>&1
) else (
    :: Try gzip if available (Git Bash, WSL, etc.)
    gzip -c "%BACKUP_FILE%" > "%COMPRESSED_FILE%" 2>nul
    if %errorlevel% neq 0 (
        call :print_warning "Failed to compress backup file. Please install 7-Zip or gzip."
        set COMPRESSED_FILE=%BACKUP_FILE%
    )
)

if "%COMPRESSED_FILE%"=="%BACKUP_FILE%" (
    call :print_warning "Backup not compressed"
) else (
    call :print_success "Backup compressed successfully"
    call :print_status "Compressed file: %COMPRESSED_FILE%"
    
    :: Get file size
    for %%A in ("%COMPRESSED_FILE%") do set FILE_SIZE=%%~zA
    set /a FILE_SIZE_MB=!FILE_SIZE!/1048576
    call :print_status "Backup size: !FILE_SIZE_MB! MB"
    
    :: Remove uncompressed file
    del "%BACKUP_FILE%" >nul 2>&1
)
goto :eof

:: Clean old backups
:cleanup_old_backups
call :print_status "Cleaning up old backups (keeping last %MAX_BACKUPS% days)..."

:: PowerShell script to clean old files
powershell -Command "Get-ChildItem '%BACKUP_DIR%\backup_*.sql.gz' -Recurse | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-%MAX_BACKUPS%)} | Remove-Item -Force" 2>nul
powershell -Command "Get-ChildItem '%BACKUP_DIR%\*.log' -Recurse | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-30)} | Remove-Item -Force" 2>nul

:: Count remaining backups
for /f %%A in ('dir /b "%BACKUP_DIR%\backup_*.sql.gz" 2^>nul ^| find /c /v ""') do set BACKUP_COUNT=%%A
call :print_status "Remaining backups: %BACKUP_COUNT%"
goto :eof

:: Verify backup integrity
:verify_backup
if exist "%COMPRESSED_FILE%" (
    call :print_status "Verifying backup integrity..."
    
    :: For 7-Zip files
    echo %COMPRESSED_FILE% | findstr ".7z" >nul
    if %errorlevel% equ 0 (
        if exist "C:\Program Files\7-Zip\7z.exe" (
            "C:\Program Files\7-Zip\7z.exe" t "%COMPRESSED_FILE%" >nul 2>&1
        ) else if exist "C:\Program Files (x86)\7-Zip\7z.exe" (
            "C:\Program Files (x86)\7-Zip\7z.exe" t "%COMPRESSED_FILE%" >nul 2>&1
        )
    ) else (
        :: For gzip files
        gzip -t "%COMPRESSED_FILE%" >nul 2>&1
    )
    
    if %errorlevel% equ 0 (
        call :print_success "Backup integrity verified"
    ) else (
        call :print_error "Backup integrity check failed"
        pause
        exit /b 1
    )
) else (
    call :print_error "Backup file not found"
    pause
    exit /b 1
)
goto :eof

:: Send notification (optional)
:send_notification
:: You can customize this section to send email, Slack notification, etc.
:: Example using curl (if available):
where curl >nul 2>&1
if %errorlevel% equ 0 (
    if not "%WEBHOOK_URL%"=="" (
        curl -X POST -H "Content-type: application/json" --data "{\"text\":\"🗄️ Database backup completed successfully for %DB_NAME% at %date% %time%\"}" "%WEBHOOK_URL%" >nul 2>&1
    )
)
goto :eof

:: Main execution
:main
echo ==========================================
echo 🗄️  Production Database Backup Script
echo ==========================================
echo Database: %DB_NAME%
echo Host: %DB_HOST%:%DB_PORT%
echo Backup Directory: %BACKUP_DIR%
echo ==========================================

call :log "Starting database backup process"

:: Execute backup steps
call :check_required_env
call :check_postgresql
call :create_backup_dir
call :get_db_credentials
call :create_backup
call :verify_backup
call :cleanup_old_backups
call :send_notification

echo ==========================================
call :print_success "Backup process completed successfully!"
echo Backup file: %COMPRESSED_FILE%
echo Log file: %LOG_FILE%
echo ==========================================

call :log "Backup process completed successfully"

pause
goto :eof

:: Run main function
call :main

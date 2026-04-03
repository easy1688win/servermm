# Lighthouse Ledger Backend API

This is the backend API for the Lighthouse Ledger system, built with Node.js, Express, TypeScript, and MySQL (Sequelize).

## Prerequisites

- Node.js (v18+)
- MySQL Server (v8.0+)
- npm or yarn

## Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Environment Variables**:
    Create a `.env` file in the `backend` root:
    ```env
    DB_HOST=localhost
    DB_USER=root
    DB_PASSWORD=your_password
    DB_NAME=lighthouse_ledger
    DB_PORT=3306
    PORT=5000
    JWT_SECRET=your_jwt_secret
    ```

3.  **Database Initialization**:
    Run the initialization scripts to create the database and seed initial data.
    ```bash
    # Create Database
    npx ts-node src/scripts/createDb.ts

    # Sync Schema and Seed Data (Admin User)
    npx ts-node src/scripts/initDb.ts
    ```

4.  **Run Development Server**:
    ```bash
    npm run dev
    ```

5.  **Build for Production**:
    ```bash
    npm run build
    npm start
    ```

## API Documentation

### Authentication

-   **POST /api/auth/login**
    -   Body: `{ "username": "admin", "password": "adminpassword" }`
    -   Response: `{ "token": "jwt_token", "user": { ... } }`

### Database Schema

-   **Users**: Staff accounts with hashed passwords.
-   **Permissions**: Granular access control.
-   **BankAccounts**: Manual tracking of bank balances.
-   **Transactions**: Deposits/Withdrawals linked to Players and Banks.
-   **AuditLogs**: Traceability of actions.

## Deployment Guide

### PM2 (Process Manager)

1.  Install PM2: `npm install -g pm2`
2.  Build project: `npm run build`
3.  Start with PM2: `pm2 start dist/server.js --name lighthouse-backend`
4.  Save config: `pm2 save`

### Docker (Optional)

Create a `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["npm", "start"]
```
cd /path/to/servermm/backend
git fetch origin
git reset --hard origin/main
git clean -fd

npm ci
npm run build   # 会自动 bump patch 版本 + tsc

pm2 restart backend
# 或 sudo systemctl restart backend
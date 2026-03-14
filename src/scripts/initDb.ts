import sequelize from '../config/database';
import { User, Permission, Role, Setting } from '../models';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const generateApiKey = () => crypto.randomBytes(32).toString('hex');

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

type InitAdminCredentialRecord = {
  createdAt: string;
  username: string;
  fullName: string;
  password?: string;
  apiKeyGenerated?: boolean;
  status: 'created' | 'already_exists';
};

const persistInitAdminCredentials = (record: InitAdminCredentialRecord) => {
  const baseDir = (process.env.INIT_ADMIN_CREDENTIALS_DIR || '').trim();
  const outDir = baseDir.length > 0 ? baseDir : path.join(process.cwd(), '.secure');
  const outFile = path.join(outDir, 'init_admin_credentials.json');

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch {
  }

  let existing: any = [];
  try {
    if (fs.existsSync(outFile)) {
      const raw = fs.readFileSync(outFile, 'utf8');
      existing = JSON.parse(raw);
    }
  } catch {
    existing = [];
  }

  const next = Array.isArray(existing) ? [...existing, record] : [existing, record];

  try {
    fs.writeFileSync(outFile, JSON.stringify(next, null, 2), { encoding: 'utf8' });
    try {
      fs.chmodSync(outFile, 0o600);
    } catch {
    }
    console.log(`Init admin credentials saved to: ${outFile}`);
  } catch (e) {
    console.log('Failed to persist init admin credentials file.');
    console.log(e);
  }
};

const PERMISSIONS = [
  // --- Routes ---
  { slug: 'route:dashboard', description: 'Access Dashboard' },
  { slug: 'view:dashboard_financials', description: 'View Dashboard Financials' },
  { slug: 'route:transactions', description: 'Access Transactions' },
  { slug: 'route:transaction_history', description: 'Access Transaction History' },
  { slug: 'route:banks', description: 'Access Banks' },
  { slug: 'route:players', description: 'Access Players' },
  { slug: 'route:audit', description: 'Access Audit Logs' },
  { slug: 'route:reports', description: 'Access Reports' },
  { slug: 'route:users', description: 'Access User Management' },
  { slug: 'route:settings', description: 'Access Settings' },

  // --- Views ---
  { slug: 'view:bank_balance', description: 'View Bank Balances' },
  { slug: 'view:bank_full_account', description: 'View Full Account #' },
  { slug: 'view:player_profit', description: 'View Player Profit' },
  { slug: 'view:sensitive_logs', description: 'View Sensitive Logs' },
  { slug: 'view:player_banks', description: 'View Player Bank Accounts' },
  { slug: 'view:system_settings', description: 'View System Settings' },
  { slug: 'view:games', description: 'View Game List' },
  { slug: 'action:game_operational', description: 'Game Operational' },
  { slug: 'view:bank_catalog', description: 'View Bank Catalog' },
  { slug: 'view:player_metadata', description: 'View Player Metadata' },
  { slug: 'view:audit_logs', description: 'View all users audit logs' },
  { slug: 'view:device_sessions', description: 'View device sessions for own account' },

  // --- Actions ---
  { slug: 'action:deposit_create', description: 'Create Deposit' },
  { slug: 'action:withdrawal_create', description: 'Create Withdrawal' },
  { slug: 'action:burn_create', description: 'Create Walve' },
  { slug: 'action:transaction_edit', description: 'Edit Transaction' },
  
  { slug: 'action:bank_create', description: 'Create Bank' },
  { slug: 'action:bank_edit', description: 'Edit Bank' },
  { slug: 'action:bank_delete', description: 'Delete Bank' },
  { slug: 'action:bank_adjust', description: 'Adjust Balance' },
  
  { slug: 'action:player_create', description: 'Create Player' },
  { slug: 'action:player_edit', description: 'Edit Player' },
  { slug: 'action:player_banks_edit', description: 'Edit Player Bank Accounts' },

  { slug: 'action:user_view', description: 'View Users' },
  { slug: 'action:user_create', description: 'Create Users' },
  { slug: 'action:user_edit', description: 'Edit Users' },
  { slug: 'action:user_delete', description: 'Delete Users' },
  { slug: 'action:user_api_manage', description: 'Rotate User API Keys' },
  { slug: 'action:role_view', description: 'View Roles' },
  { slug: 'action:role_manage', description: 'Manage Roles' },
  { slug: 'action:settings_manage', description: 'Manage Settings' },
  { slug: 'action:device_session_revoke', description: 'Revoke device sessions for own account' },
  { slug: 'action:device_fingerprint_lock', description: 'Lock device fingerprint for an account' },
  { slug: 'action:security_manage', description: 'Manage Security Settings (2FA, etc.)' }
];

const ROLES = [
  {
    name: 'Super Admin',
    description: 'Full access to all system features',
    isSystem: true,
    permissions: ['*'] // Special flag for all
  },
  {
    name: 'Operator',
    description: 'Can process transactions and manage players',
    isSystem: false,
    permissions: [
      'route:dashboard', 'route:transactions', 'route:transaction_history', 'route:players',
      'action:deposit_create', 'action:withdrawal_create', 'action:player_create', 'action:player_edit',
      'view:player_banks', 'action:player_banks_edit'
    ]
  },
  {
    name: 'Viewer',
    description: 'Read-only access to reports and balances',
    isSystem: false,
    permissions: [
      'route:dashboard', 'route:reports', 'route:banks',
      'view:bank_balance'
    ]
  }
];

async function createDatabase() {
  try {
    const connection = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      port: Number(DB_PORT) || 3306,
    });

    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
    console.log(`Database ${DB_NAME} created or already exists.`);
    await connection.end();
  } catch (error) {
    console.error('Error creating database:', error);
    process.exit(1);
  }
}

async function initDb() {
  try {
    await createDatabase();

    await sequelize.authenticate();
    console.log('Database connected.');

    // Sync models
    await sequelize.sync({ alter: true });
    console.log('Database synced.');

    // Seed Permissions
    for (const p of PERMISSIONS) {
      await Permission.findOrCreate({
        where: { slug: p.slug },
        defaults: p,
      });
    }
    console.log('Permissions seeded.');

    // Seed Roles
    for (const r of ROLES) {
      const [role, created] = await Role.findOrCreate({
        where: { name: r.name },
        defaults: {
          name: r.name,
          description: r.description,
          isSystem: r.isSystem
        }
      });

      if (r.permissions.includes('*')) {
        const allPerms = await Permission.findAll();
        // @ts-ignore
        await role.setPermissions(allPerms);
      } else {
        const perms = await Permission.findAll({
          where: { slug: r.permissions }
        });
        // @ts-ignore
        await role.setPermissions(perms);
      }
    }
    console.log('Roles seeded.');

    // Create Admin User
    const storedAdminUsernameSetting = await Setting.findByPk('init_admin_username');
    const storedAdminUsername =
      storedAdminUsernameSetting && typeof (storedAdminUsernameSetting as any).value === 'string'
        ? String((storedAdminUsernameSetting as any).value).trim()
        : null;

    const adminUsernameFromEnv = (process.env.INIT_ADMIN_USERNAME || '').trim();
    const adminFullNameFromEnv = (process.env.INIT_ADMIN_FULL_NAME || '').trim();
    const adminPasswordFromEnv = (process.env.INIT_ADMIN_PASSWORD || '').trim();

    const generatedUsername = `sys_${crypto.randomBytes(9).toString('hex')}`;
    const generatedPassword = crypto.randomBytes(24).toString('base64url');

    const adminUsername = adminUsernameFromEnv || storedAdminUsername || generatedUsername;
    const adminPassword = adminPasswordFromEnv || generatedPassword;
    const adminFullName = adminFullNameFromEnv || 'System Admin';

    if (!storedAdminUsername && !adminUsernameFromEnv) {
      await Setting.findOrCreate({
        where: { key: 'init_admin_username' },
        defaults: {
          key: 'init_admin_username',
          value: adminUsername,
        },
      });
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const [admin, created] = await User.findOrCreate({
      where: { username: adminUsername },
      defaults: {
        username: adminUsername,
        password_hash: hashedPassword,
        status: 'active',
        full_name: adminFullName,
        api_key: generateApiKey(),
      },
    });

    if (created) {
      console.log('Admin user created.');
      persistInitAdminCredentials({
        createdAt: new Date().toISOString(),
        username: adminUsername,
        fullName: adminFullName,
        password: adminPassword,
        status: 'created',
      });
    } else {
      console.log('Admin user already exists.');
      persistInitAdminCredentials({
        createdAt: new Date().toISOString(),
        username: adminUsername,
        fullName: adminFullName,
        status: 'already_exists',
      });
    }

    if (!admin.full_name && adminFullName) {
      admin.full_name = adminFullName;
      await admin.save();
    }

    if (!admin.api_key) {
      admin.api_key = generateApiKey();
      await admin.save();
      console.log('Admin API key generated.');
    }

    // Assign Super Admin role to admin
    const superAdminRole = await Role.findOne({ where: { name: 'Super Admin' } });
    if (superAdminRole) {
       // @ts-ignore
       await admin.setRoles([superAdminRole]);
       console.log('Admin assigned Super Admin role.');
    }
    
    const usersWithoutKey: any[] = await User.findAll({ where: { api_key: null } as any });
    for (const user of usersWithoutKey) {
      user.api_key = generateApiKey();
      await user.save();
    }

    // Seed Player Metadata Settings
    const defaultReferralSources = [
      'Google',
      'Facebook',
      'Telegram',
      'Line',
      'Friend',
    ];

    const defaultPlayerTags = [
      { name: 'New', color: '#3b82f6' }, // Blue
      { name: 'VIP', color: '#f97316' }, // Orange
      { name: 'Bonus Hunter', color: '#ef4444' }, // Red
      { name: 'Regular', color: '#22c55e' }, // Green
    ];

    await Setting.findOrCreate({
      where: { key: 'referralSources' },
      defaults: {
        key: 'referralSources',
        value: defaultReferralSources
      }
    });

    await Setting.findOrCreate({
      where: { key: 'tagOptions' },
      defaults: {
        key: 'tagOptions',
        value: defaultPlayerTags
      }
    });
    

    process.exit(0);
  } catch (error) {
    console.error('Error initializing DB:', error);
    process.exit(1);
  }
}

initDb();

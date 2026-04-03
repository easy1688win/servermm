import sequelize from '../config/database';
import { User, Permission, Role, Setting, Tenant, SubBrand } from '../models';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const generateApiKey = () => crypto.randomBytes(32).toString('hex');

// Permission definitions
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
  { slug: 'route:marketing', description: 'Access Marketing' },

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
  { slug: 'action:security_manage', description: 'Manage Security Settings (2FA, etc.)' },
  { slug: 'action:marketing_manage', description: 'Manage Marketing Landing Pages' },
];

const ROLES = [
  {
    name: 'Super Admin',
    description: 'Full access to all system features',
    isSystem: true,
    permissions: ['*']
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

async function initDb() {
  console.log('========================================');
  console.log('🔧 Database Initialization Started');
  console.log('========================================');
  console.log(`Database: ${process.env.DB_NAME}`);
  console.log(`Host: ${process.env.DB_SOCKET_PATH || process.env.DB_HOST}`);
  console.log('========================================\n');

  try {
    // Test database connection
    console.log('⏳ Testing database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connected successfully.\n');

    // Sync models (create tables)
    console.log('⏳ Syncing database tables...');
    await sequelize.sync({ alter: true });
    console.log('✅ Database tables synced.\n');

    // Initialize default tenant
    const defaultTenantPrefix = (process.env.INIT_TENANT_PREFIX || '').trim();
    const defaultTenantName = (process.env.INIT_TENANT_NAME || '').trim();

    const [defaultTenant] = await Tenant.findOrCreate({
      where: { prefix: defaultTenantPrefix },
      defaults: {
        prefix: defaultTenantPrefix,
        name: defaultTenantName,
        status: 'active',
      },
    });
    console.log(`✅ Default tenant ready: ${defaultTenant.name} (${defaultTenant.prefix})`);

    // Initialize default sub-brand
    const defaultSubBrandCode = (process.env.INIT_SUB_BRAND_CODE || '').trim();
    const defaultSubBrandName = (process.env.INIT_SUB_BRAND_NAME || '').trim();

    const [defaultSubBrand] = await SubBrand.findOrCreate({
      where: { code: defaultSubBrandCode },
      defaults: {
        tenant_id: defaultTenant.id,
        code: defaultSubBrandCode,
        name: defaultSubBrandName,
        status: 'active',
      },
    });
    console.log(`✅ Default sub-brand ready: ${defaultSubBrand.name} (${defaultSubBrand.code})\n`);

    // Seed Permissions
    console.log('⏳ Seeding permissions...');
    for (const p of PERMISSIONS) {
      await Permission.findOrCreate({
        where: { slug: p.slug },
        defaults: p,
      });
    }
    console.log(`✅ ${PERMISSIONS.length} permissions ready.\n`);

    // Seed Roles
    console.log('⏳ Seeding roles...');
    for (const r of ROLES) {
      const [role] = await Role.findOrCreate({
        where: { name: r.name },
        defaults: {
          name: r.name,
          description: r.description,
          isSystem: r.isSystem
        }
      });

      // Assign permissions
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
    console.log(`✅ ${ROLES.length} roles ready.\n`);

    // Create Admin User
    console.log('⏳ Creating admin user...');

    // Fixed admin credentials
    const adminUsername = 'superadminsparkx';
    const adminPassword = crypto.randomBytes(16).toString('base64url');
    const adminFullName = 'System Administrator';

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const [admin, created] = await User.findOrCreate({
      where: { username: adminUsername },
      defaults: {
        username: adminUsername,
        password_hash: hashedPassword,
        status: 'active',
        full_name: adminFullName,
        api_key: generateApiKey(),
        tenant_id: defaultTenant.id,
        sub_brand_id: defaultSubBrand.id,
        is_super_admin: true,
      },
    });

    if (created) {
      // Assign Super Admin role
      const superAdminRole = await Role.findOne({ where: { name: 'Super Admin' } });
      if (superAdminRole) {
        // @ts-ignore
        await admin.setRoles([superAdminRole]);
      }

      console.log('\n========================================');
      console.log('🎉 ADMIN USER CREATED');
      console.log('========================================');
      console.log(`Username: ${adminUsername}`);
      console.log(`Password: ${adminPassword}`);
      console.log(`Full Name: ${adminFullName}`);
      console.log('========================================');
      console.log('⚠️  IMPORTANT: Save these credentials now!');
      console.log('   This password will NOT be shown again.');
      console.log('========================================\n');
    } else {
      console.log(`ℹ️  Admin user '${adminUsername}' already exists.\n`);
    }

    // Initialize Settings
    console.log('⏳ Initializing settings...');

    const defaultReferralSources = ['Google', 'Facebook', 'Telegram', 'Line', 'Friend'];
    const defaultPlayerTags = [
      { name: 'New', color: '#3b82f6' },
      { name: 'VIP', color: '#f97316' },
      { name: 'Bonus Hunter', color: '#ef4444' },
      { name: 'Regular', color: '#22c55e' },
    ];

    await Setting.findOrCreate({
      where: { key: 'referralSources' },
      defaults: { key: 'referralSources', value: defaultReferralSources }
    });

    await Setting.findOrCreate({
      where: { key: 'tagOptions' },
      defaults: { key: 'tagOptions', value: defaultPlayerTags }
    });

    console.log('✅ Default settings ready.\n');

    console.log('========================================');
    console.log('✅ DATABASE INITIALIZATION COMPLETE');
    console.log('========================================');
    console.log('You can now start using the application.');
    console.log('========================================');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR: Database initialization failed:');
    console.error(error);
    process.exit(1);
  }
}

initDb();

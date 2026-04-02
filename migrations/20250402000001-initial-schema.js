'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    // ============================================
    // 1. Tenants (Multi-tenancy support)
    // ============================================
    await queryInterface.createTable('tenants', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'suspended'),
        defaultValue: 'active'
      },
      settings: {
        type: DataTypes.JSON,
        defaultValue: {}
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // ============================================
    // 2. SubBrands
    // ============================================
    await queryInterface.createTable('sub_brands', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'tenants',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      api_key: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active'
      },
      settings: {
        type: DataTypes.JSON,
        defaultValue: {}
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint on sub_brands
    await queryInterface.addIndex('sub_brands', ['tenant_id', 'code'], {
      unique: true,
      name: 'sub_brands_tenant_code_unique'
    });

    // ============================================
    // 3. Users (Staff/Admin accounts)
    // ============================================
    await queryInterface.createTable('users', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      full_name: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      phone: {
        type: DataTypes.STRING(20),
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'banned', 'pending_2fa'),
        defaultValue: 'active'
      },
      api_key: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      two_factor_secret: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      two_factor_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      last_login_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // ============================================
    // 4. Roles
    // ============================================
    await queryInterface.createTable('roles', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      slug: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      is_system: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint on roles
    await queryInterface.addIndex('roles', ['tenant_id', 'slug'], {
      unique: true,
      name: 'roles_tenant_slug_unique'
    });

    // ============================================
    // 5. Permissions
    // ============================================
    await queryInterface.createTable('permissions', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      category: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // ============================================
    // 6. UserRoles (Pivot table)
    // ============================================
    await queryInterface.createTable('user_roles', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      role_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'roles',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint
    await queryInterface.addIndex('user_roles', ['user_id', 'role_id'], {
      unique: true,
      name: 'user_roles_unique'
    });

    // ============================================
    // 7. RolePermissions (Pivot table)
    // ============================================
    await queryInterface.createTable('role_permissions', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      role_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'roles',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      permission_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'permissions',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint
    await queryInterface.addIndex('role_permissions', ['role_id', 'permission_id'], {
      unique: true,
      name: 'role_permissions_unique'
    });

    // ============================================
    // 8. UserPermissions (Direct user permissions)
    // ============================================
    await queryInterface.createTable('user_permissions', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      permission_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'permissions',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      granted: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint
    await queryInterface.addIndex('user_permissions', ['user_id', 'permission_id'], {
      unique: true,
      name: 'user_permissions_unique'
    });

    // ============================================
    // 9. Players (Gaming users)
    // ============================================
    await queryInterface.createTable('players', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      sub_brand_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'sub_brands',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      player_game_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true
      },
      full_name: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      phone: {
        type: DataTypes.STRING(20),
        allowNull: true
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'banned', 'suspended'),
        defaultValue: 'active'
      },
      tags: {
        type: DataTypes.JSON,
        defaultValue: []
      },
      total_in: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      total_out: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      balance: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      credit_limit: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
      },
      last_login_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // ============================================
    // 10. BankCatalog (Bank reference data)
    // ============================================
    await queryInterface.createTable('bank_catalogs', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      name_en: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      swift_code: {
        type: DataTypes.STRING(20),
        allowNull: true
      },
      icon: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active'
      },
      display_order: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // ============================================
    // 11. BankAccounts
    // ============================================
    await queryInterface.createTable('bank_accounts', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      catalog_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'bank_catalogs',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      alias: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      bank_name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      account_number: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      account_number_hash: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      account_holder: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      account_type: {
        type: DataTypes.ENUM('checking', 'savings', 'credit', 'other'),
        defaultValue: 'checking'
      },
      currency: {
        type: DataTypes.STRING(3),
        defaultValue: 'CNY'
      },
      total_balance: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      available_balance: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'frozen', 'closed'),
        defaultValue: 'active'
      },
      is_default: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // ============================================
    // 12. Transactions (Deposits/Withdrawals)
    // ============================================
    await queryInterface.createTable('transactions', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      player_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'players',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      bank_account_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'bank_accounts',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      operator_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'RESTRICT'
      },
      type: {
        type: DataTypes.ENUM('DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT', 'BURN', 'TRANSFER'),
        allowNull: false
      },
      amount: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false
      },
      fee: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      net_amount: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false
      },
      currency: {
        type: DataTypes.STRING(3),
        defaultValue: 'CNY'
      },
      status: {
        type: DataTypes.ENUM('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED'),
        defaultValue: 'PENDING'
      },
      reference_number: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      external_reference: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      processed_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      staff_note: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      player_note: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      attachment_url: {
        type: DataTypes.STRING(500),
        allowNull: true
      },
      metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Add indexes for transactions
    await queryInterface.addIndex('transactions', ['player_id', 'created_at'], {
      name: 'transactions_player_date_idx'
    });
    await queryInterface.addIndex('transactions', ['status', 'type'], {
      name: 'transactions_status_type_idx'
    });
    await queryInterface.addIndex('transactions', ['operator_id'], {
      name: 'transactions_operator_idx'
    });

    // ============================================
    // 13. Products (Games catalog)
    // ============================================
    await queryInterface.createTable('products', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      provider: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      category: {
        type: DataTypes.ENUM('slots', 'live_casino', 'sports', 'lottery', 'arcade', 'table', 'other'),
        defaultValue: 'other'
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      icon: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'maintenance'),
        defaultValue: 'active'
      },
      is_featured: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      display_order: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      config: {
        type: DataTypes.JSON,
        defaultValue: {}
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // ============================================
    // 14. Games (Individual game instances)
    // ============================================
    await queryInterface.createTable('games', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      product_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'products',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      icon: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      rtp: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true
      },
      volatility: {
        type: DataTypes.ENUM('low', 'medium', 'high'),
        allowNull: true
      },
      min_bet: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: true
      },
      max_bet: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'maintenance'),
        defaultValue: 'active'
      },
      is_featured: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      display_order: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      config: {
        type: DataTypes.JSON,
        defaultValue: {}
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint
    await queryInterface.addIndex('games', ['product_id', 'code'], {
      unique: true,
      name: 'games_product_code_unique'
    });

    // ============================================
    // 15. GameAdjustments
    // ============================================
    await queryInterface.createTable('game_adjustments', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      game_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'games',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      operator_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'RESTRICT'
      },
      adjustment_type: {
        type: DataTypes.ENUM('settings', 'rtp', 'limits', 'status', 'other'),
        allowNull: false
      },
      field_name: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      old_value: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      new_value: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // ============================================
    // 16. PlayerStats
    // ============================================
    await queryInterface.createTable('player_stats', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      player_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'players',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      game_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'games',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      session_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      total_bet: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      total_win: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      total_loss: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      net_profit: {
        type: DataTypes.DECIMAL(18, 2),
        defaultValue: 0
      },
      last_played_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      stat_date: {
        type: DataTypes.DATEONLY,
        allowNull: false
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint
    await queryInterface.addIndex('player_stats', ['player_id', 'game_id', 'stat_date'], {
      unique: true,
      name: 'player_stats_unique'
    });

    // ============================================
    // 17. AuditLogs
    // ============================================
    await queryInterface.createTable('audit_logs', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      player_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'players',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      action: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      entity_type: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      entity_id: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      original_data: {
        type: DataTypes.JSON,
        allowNull: true
      },
      new_data: {
        type: DataTypes.JSON,
        allowNull: true
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true
      },
      user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add indexes for audit_logs
    await queryInterface.addIndex('audit_logs', ['user_id', 'created_at'], {
      name: 'audit_logs_user_date_idx'
    });
    await queryInterface.addIndex('audit_logs', ['entity_type', 'entity_id'], {
      name: 'audit_logs_entity_idx'
    });
    await queryInterface.addIndex('audit_logs', ['action'], {
      name: 'audit_logs_action_idx'
    });

    // ============================================
    // 18. Settings
    // ============================================
    await queryInterface.createTable('settings', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      key: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      value: {
        type: DataTypes.JSON,
        allowNull: true
      },
      type: {
        type: DataTypes.ENUM('string', 'number', 'boolean', 'json', 'array'),
        defaultValue: 'string'
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      is_public: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      is_system: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint
    await queryInterface.addIndex('settings', ['tenant_id', 'key'], {
      unique: true,
      name: 'settings_tenant_key_unique'
    });

    // ============================================
    // 19. UserSessions
    // ============================================
    await queryInterface.createTable('user_sessions', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      token: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      refresh_token: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true
      },
      user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      device_info: {
        type: DataTypes.JSON,
        allowNull: true
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false
      },
      last_active_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      is_revoked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add indexes
    await queryInterface.addIndex('user_sessions', ['user_id', 'expires_at'], {
      name: 'user_sessions_user_expiry_idx'
    });
    await queryInterface.addIndex('user_sessions', ['token(255)'], {
      name: 'user_sessions_token_idx'
    });

    // ============================================
    // 20. UserDeviceLocks
    // ============================================
    await queryInterface.createTable('user_device_locks', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      device_fingerprint: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      device_name: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      is_allowed: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
      },
      is_blocked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      blocked_reason: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      last_used_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint
    await queryInterface.addIndex('user_device_locks', ['user_id', 'device_fingerprint'], {
      unique: true,
      name: 'user_device_locks_unique'
    });

    // ============================================
    // 21. LandingPages
    // ============================================
    await queryInterface.createTable('landing_pages', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      sub_brand_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'sub_brands',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      title: {
        type: DataTypes.STRING(200),
        allowNull: true
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      template: {
        type: DataTypes.STRING(50),
        defaultValue: 'default'
      },
      status: {
        type: DataTypes.ENUM('draft', 'published', 'archived'),
        defaultValue: 'draft'
      },
      settings: {
        type: DataTypes.JSON,
        defaultValue: {}
      },
      published_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Add unique constraint
    await queryInterface.addIndex('landing_pages', ['tenant_id', 'slug'], {
      unique: true,
      name: 'landing_pages_tenant_slug_unique'
    });

    // ============================================
    // 22. LandingPageVisits
    // ============================================
    await queryInterface.createTable('landing_page_visits', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      landing_page_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'landing_pages',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      visitor_ip: {
        type: DataTypes.STRING(45),
        allowNull: true
      },
      user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      referrer: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      device_type: {
        type: DataTypes.STRING(20),
        allowNull: true
      },
      browser: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      os: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      country: {
        type: DataTypes.STRING(2),
        allowNull: true
      },
      utm_source: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      utm_medium: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      utm_campaign: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      session_duration: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add indexes
    await queryInterface.addIndex('landing_page_visits', ['landing_page_id', 'created_at'], {
      name: 'lp_visits_page_date_idx'
    });

    // ============================================
    // 23. LandingPageEvents
    // ============================================
    await queryInterface.createTable('landing_page_events', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      landing_page_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'landing_pages',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      visit_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'landing_page_visits',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      event_type: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      event_data: {
        type: DataTypes.JSON,
        allowNull: true
      },
      element_id: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add indexes
    await queryInterface.addIndex('landing_page_events', ['landing_page_id', 'event_type'], {
      name: 'lp_events_page_type_idx'
    });

    console.log('✅ Initial migration completed successfully!');
    console.log('');
    console.log('Created tables:');
    console.log('  - tenants, sub_brands, users, roles, permissions');
    console.log('  - user_roles, role_permissions, user_permissions');
    console.log('  - players, bank_catalogs, bank_accounts, transactions');
    console.log('  - products, games, game_adjustments, player_stats');
    console.log('  - audit_logs, settings, user_sessions, user_device_locks');
    console.log('  - landing_pages, landing_page_visits, landing_page_events');
  },

  async down(queryInterface, Sequelize) {
    // Drop tables in reverse order (respecting foreign key constraints)
    await queryInterface.dropTable('landing_page_events');
    await queryInterface.dropTable('landing_page_visits');
    await queryInterface.dropTable('landing_pages');
    await queryInterface.dropTable('user_device_locks');
    await queryInterface.dropTable('user_sessions');
    await queryInterface.dropTable('settings');
    await queryInterface.dropTable('audit_logs');
    await queryInterface.dropTable('player_stats');
    await queryInterface.dropTable('game_adjustments');
    await queryInterface.dropTable('games');
    await queryInterface.dropTable('products');
    await queryInterface.dropTable('transactions');
    await queryInterface.dropTable('bank_accounts');
    await queryInterface.dropTable('bank_catalogs');
    await queryInterface.dropTable('players');
    await queryInterface.dropTable('user_permissions');
    await queryInterface.dropTable('role_permissions');
    await queryInterface.dropTable('user_roles');
    await queryInterface.dropTable('permissions');
    await queryInterface.dropTable('roles');
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('sub_brands');
    await queryInterface.dropTable('tenants');

    console.log('✅ All tables dropped successfully!');
  }
};

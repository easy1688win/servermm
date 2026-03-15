'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'landing_pages';

    const existingTables = await queryInterface.showAllTables();
    const hasTable = Array.isArray(existingTables)
      ? existingTables.some((t) => String(t).toLowerCase() === tableName)
      : false;

    if (!hasTable) {
      await queryInterface.createTable(tableName, {
        id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        name: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        page_url: {
          type: Sequelize.STRING(2048),
          allowNull: false,
        },
        source: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM('active', 'inactive'),
          allowNull: false,
          defaultValue: 'active',
        },
        operator_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });

      await queryInterface.addIndex(tableName, ['status']);
      await queryInterface.addIndex(tableName, ['source']);
      await queryInterface.addIndex(tableName, ['operator_id']);
      await queryInterface.addIndex(tableName, ['page_url']);
      return;
    }

    let desc;
    try {
      desc = await queryInterface.describeTable(tableName);
    } catch {
      return;
    }

    const hasCol = (col) => Object.prototype.hasOwnProperty.call(desc, col);

    if (hasCol('pageUrl') && !hasCol('page_url')) {
      await queryInterface.renameColumn(tableName, 'pageUrl', 'page_url');
    }
    if (hasCol('operatorId') && !hasCol('operator_id')) {
      await queryInterface.renameColumn(tableName, 'operatorId', 'operator_id');
    }
    if (hasCol('createdAt') && !hasCol('created_at')) {
      await queryInterface.renameColumn(tableName, 'createdAt', 'created_at');
    }
    if (hasCol('updatedAt') && !hasCol('updated_at')) {
      await queryInterface.renameColumn(tableName, 'updatedAt', 'updated_at');
    }

    desc = await queryInterface.describeTable(tableName);

    if (!Object.prototype.hasOwnProperty.call(desc, 'name')) {
      await queryInterface.addColumn(tableName, 'name', { type: Sequelize.STRING, allowNull: false, defaultValue: '' });
    }
    if (!Object.prototype.hasOwnProperty.call(desc, 'page_url')) {
      await queryInterface.addColumn(tableName, 'page_url', { type: Sequelize.STRING(2048), allowNull: false, defaultValue: '' });
    }
    if (!Object.prototype.hasOwnProperty.call(desc, 'source')) {
      await queryInterface.addColumn(tableName, 'source', { type: Sequelize.STRING, allowNull: true });
    }
    if (!Object.prototype.hasOwnProperty.call(desc, 'status')) {
      await queryInterface.addColumn(tableName, 'status', {
        type: Sequelize.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active',
      });
    }
    if (!Object.prototype.hasOwnProperty.call(desc, 'operator_id')) {
      await queryInterface.addColumn(tableName, 'operator_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
    if (!Object.prototype.hasOwnProperty.call(desc, 'created_at')) {
      await queryInterface.addColumn(tableName, 'created_at', {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      });
    }
    if (!Object.prototype.hasOwnProperty.call(desc, 'updated_at')) {
      await queryInterface.addColumn(tableName, 'updated_at', {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      });
    }

    try {
      await queryInterface.addIndex(tableName, ['status']);
    } catch {}
    try {
      await queryInterface.addIndex(tableName, ['source']);
    } catch {}
    try {
      await queryInterface.addIndex(tableName, ['operator_id']);
    } catch {}
    try {
      await queryInterface.addIndex(tableName, ['page_url']);
    } catch {}
  },

  async down(queryInterface) {
    const tableName = 'landing_pages';
    try {
      await queryInterface.dropTable(tableName);
    } catch {}
    try {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS `enum_landing_pages_status`;');
    } catch {}
  },
};


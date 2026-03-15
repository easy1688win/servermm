'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'landing_page_events';
    const existingTables = await queryInterface.showAllTables();
    const hasTable = Array.isArray(existingTables)
      ? existingTables.some((t) => String(t).toLowerCase() === tableName)
      : false;
    if (hasTable) return;

    await queryInterface.createTable(tableName, {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      landing_page_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'landing_pages',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      event_name: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      element_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      session_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      ip_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      ip_enc: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
      },
      meta: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      os: {
        type: Sequelize.STRING(32),
        allowNull: true,
      },
      browser: {
        type: Sequelize.STRING(32),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      is_bot: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex(tableName, ['landing_page_id', 'created_at']);
    await queryInterface.addIndex(tableName, ['landing_page_id', 'event_name']);
    await queryInterface.addIndex(tableName, ['landing_page_id', 'ip_hash']);
  },

  async down(queryInterface) {
    try {
      await queryInterface.dropTable('landing_page_events');
    } catch {}
  },
};


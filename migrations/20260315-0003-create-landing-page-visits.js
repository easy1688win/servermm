'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'landing_page_visits';
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
      page_url: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
      },
      referrer_origin: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      referrer_path: {
        type: Sequelize.STRING(1024),
        allowNull: true,
      },
      utm_source: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      utm_campaign: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      utm_medium: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      utm_content: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      utm_term: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      fbclid: {
        type: Sequelize.STRING(255),
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
    await queryInterface.addIndex(tableName, ['landing_page_id', 'ip_hash']);
    await queryInterface.addIndex(tableName, ['landing_page_id', 'referrer_origin']);
  },

  async down(queryInterface) {
    try {
      await queryInterface.dropTable('landing_page_visits');
    } catch {}
  },
};


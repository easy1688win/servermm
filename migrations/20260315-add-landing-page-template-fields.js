'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'landing_pages';
    let desc;
    try {
      desc = await queryInterface.describeTable(tableName);
    } catch {
      return;
    }

    const has = (c) => Object.prototype.hasOwnProperty.call(desc, c);

    if (!has('theme')) {
      await queryInterface.addColumn(tableName, 'theme', {
        type: Sequelize.ENUM('light', 'dark', 'auto'),
        allowNull: false,
        defaultValue: 'auto',
      });
    }
    if (!has('title')) {
      await queryInterface.addColumn(tableName, 'title', { type: Sequelize.STRING(120), allowNull: true });
    }
    if (!has('subtitle')) {
      await queryInterface.addColumn(tableName, 'subtitle', { type: Sequelize.STRING(240), allowNull: true });
    }
    if (!has('hero_image_url')) {
      await queryInterface.addColumn(tableName, 'hero_image_url', { type: Sequelize.STRING(2048), allowNull: true });
    }
    if (!has('primary_cta_text')) {
      await queryInterface.addColumn(tableName, 'primary_cta_text', { type: Sequelize.STRING(60), allowNull: true });
    }
    if (!has('primary_cta_url')) {
      await queryInterface.addColumn(tableName, 'primary_cta_url', { type: Sequelize.STRING(2048), allowNull: true });
    }
    if (!has('secondary_cta_text')) {
      await queryInterface.addColumn(tableName, 'secondary_cta_text', { type: Sequelize.STRING(60), allowNull: true });
    }
    if (!has('secondary_cta_url')) {
      await queryInterface.addColumn(tableName, 'secondary_cta_url', { type: Sequelize.STRING(2048), allowNull: true });
    }
  },

  async down(queryInterface) {
    const tableName = 'landing_pages';
    const remove = async (col) => {
      try {
        await queryInterface.removeColumn(tableName, col);
      } catch {}
    };
    await remove('secondary_cta_url');
    await remove('secondary_cta_text');
    await remove('primary_cta_url');
    await remove('primary_cta_text');
    await remove('hero_image_url');
    await remove('subtitle');
    await remove('title');
    await remove('theme');
  },
};


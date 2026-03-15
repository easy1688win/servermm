'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const addIfMissing = async (tableName, columnName, definition) => {
      let desc;
      try {
        desc = await queryInterface.describeTable(tableName);
      } catch {
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(desc, columnName)) {
        await queryInterface.addColumn(tableName, columnName, definition);
      }
    };

    for (const tableName of ['landing_page_visits', 'landing_page_events']) {
      await addIfMissing(tableName, 'device_type', {
        type: Sequelize.ENUM('mobile', 'desktop', 'tablet', 'other'),
        allowNull: true,
      });
      await addIfMissing(tableName, 'language', { type: Sequelize.STRING(16), allowNull: true });
      await addIfMissing(tableName, 'timezone_offset', { type: Sequelize.INTEGER, allowNull: true });
      await addIfMissing(tableName, 'screen', { type: Sequelize.STRING(32), allowNull: true });
      await addIfMissing(tableName, 'suspected_bot', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });

      try {
        await queryInterface.addIndex(tableName, ['landing_page_id', 'is_bot', 'created_at']);
      } catch {}
    }
  },

  async down(queryInterface) {
    const remove = async (tableName, columnName) => {
      try {
        await queryInterface.removeColumn(tableName, columnName);
      } catch {}
    };
    for (const tableName of ['landing_page_visits', 'landing_page_events']) {
      await remove(tableName, 'suspected_bot');
      await remove(tableName, 'screen');
      await remove(tableName, 'timezone_offset');
      await remove(tableName, 'language');
      await remove(tableName, 'device_type');
    }
  },
};


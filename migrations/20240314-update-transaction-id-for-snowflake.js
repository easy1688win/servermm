'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Update transaction ID column to accommodate Snowflake IDs (64-bit integers)
    await queryInterface.changeColumn('transactions', 'id', {
      type: Sequelize.STRING(20), // Increased from 32 to 20 for Snowflake IDs
      allowNull: false,
      primaryKey: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Revert back to original column size
    await queryInterface.changeColumn('transactions', 'id', {
      type: Sequelize.STRING(32),
      allowNull: false,
      primaryKey: true,
    });
  }
};

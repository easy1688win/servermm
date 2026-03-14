'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Update transaction ID column to accommodate Snowflake IDs (64-bit integers)
    await queryInterface.changeColumn('transactions', 'id', {
      type: Sequelize.STRING(25), // Increased to accommodate 64-bit Snowflake IDs
      allowNull: false,
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Revert back to original column size
    await queryInterface.changeColumn('transactions', 'id', {
      type: Sequelize.STRING(32),
      allowNull: false,
    });
  }
};

'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const permissionsToEnsure = [
      { slug: 'route:marketing', description: 'Access Marketing' },
      { slug: 'action:marketing_manage', description: 'Manage Marketing Landing Pages' },
    ];

    await queryInterface.sequelize.transaction(async (transaction) => {
      let permDesc;
      try {
        permDesc = await queryInterface.describeTable('permissions');
      } catch {
        return;
      }

      const hasCreatedAt = Object.prototype.hasOwnProperty.call(permDesc, 'createdAt');
      const hasUpdatedAt = Object.prototype.hasOwnProperty.call(permDesc, 'updatedAt');
      const hasCreatedAtSnake = Object.prototype.hasOwnProperty.call(permDesc, 'created_at');
      const hasUpdatedAtSnake = Object.prototype.hasOwnProperty.call(permDesc, 'updated_at');

      const slugs = permissionsToEnsure.map((p) => p.slug);
      const placeholders = slugs.map(() => '?').join(',');
      const [existingRows] = await queryInterface.sequelize.query(
        `SELECT id, slug FROM permissions WHERE slug IN (${placeholders})`,
        { replacements: slugs, transaction }
      );

      const existing = new Map();
      if (Array.isArray(existingRows)) {
        for (const r of existingRows) {
          if (r && typeof r.slug === 'string') existing.set(r.slug, r);
        }
      }

      const toInsert = [];
      for (const p of permissionsToEnsure) {
        if (existing.has(p.slug)) continue;
        const row = { slug: p.slug, description: p.description };
        if (hasCreatedAt) row.createdAt = now;
        if (hasUpdatedAt) row.updatedAt = now;
        if (hasCreatedAtSnake) row.created_at = now;
        if (hasUpdatedAtSnake) row.updated_at = now;
        toInsert.push(row);
      }

      if (toInsert.length > 0) {
        await queryInterface.bulkInsert('permissions', toInsert, { transaction });
      }

      const [permRows] = await queryInterface.sequelize.query(
        `SELECT id, slug FROM permissions WHERE slug IN (${placeholders})`,
        { replacements: slugs, transaction }
      );

      const permIdBySlug = new Map();
      if (Array.isArray(permRows)) {
        for (const r of permRows) {
          if (r && typeof r.slug === 'string') permIdBySlug.set(r.slug, r.id);
        }
      }

      let roleDesc;
      try {
        roleDesc = await queryInterface.describeTable('roles');
      } catch {
        roleDesc = null;
      }

      const roleIsSystemCol =
        roleDesc && Object.prototype.hasOwnProperty.call(roleDesc, 'isSystem')
          ? 'isSystem'
          : roleDesc && Object.prototype.hasOwnProperty.call(roleDesc, 'is_system')
            ? 'is_system'
            : null;

      const roleWhere = roleIsSystemCol ? `(${roleIsSystemCol} = 1 OR name = 'Super Admin')` : `(name = 'Super Admin')`;
      const [roleRows] = await queryInterface.sequelize.query(
        `SELECT id FROM roles WHERE ${roleWhere}`,
        { transaction }
      );

      const roleIds = Array.isArray(roleRows) ? roleRows.map((r) => r.id).filter((id) => id != null) : [];
      const permIds = slugs.map((s) => permIdBySlug.get(s)).filter((id) => id != null);
      if (roleIds.length === 0 || permIds.length === 0) return;

      let rpDesc;
      try {
        rpDesc = await queryInterface.describeTable('role_permissions');
      } catch {
        return;
      }

      const roleIdCol = Object.prototype.hasOwnProperty.call(rpDesc, 'roleId')
        ? 'roleId'
        : Object.prototype.hasOwnProperty.call(rpDesc, 'role_id')
          ? 'role_id'
          : null;
      const permIdCol = Object.prototype.hasOwnProperty.call(rpDesc, 'permissionId')
        ? 'permissionId'
        : Object.prototype.hasOwnProperty.call(rpDesc, 'permission_id')
          ? 'permission_id'
          : null;
      if (!roleIdCol || !permIdCol) return;

      const rolePlaceholders = roleIds.map(() => '?').join(',');
      const permPlaceholders2 = permIds.map(() => '?').join(',');
      const [existingLinks] = await queryInterface.sequelize.query(
        `SELECT ${roleIdCol} AS roleId, ${permIdCol} AS permissionId FROM role_permissions WHERE ${roleIdCol} IN (${rolePlaceholders}) AND ${permIdCol} IN (${permPlaceholders2})`,
        { replacements: [...roleIds, ...permIds], transaction }
      );

      const linkSet = new Set();
      if (Array.isArray(existingLinks)) {
        for (const r of existingLinks) {
          if (r && r.roleId != null && r.permissionId != null) linkSet.add(`${r.roleId}:${r.permissionId}`);
        }
      }

      const linkRows = [];
      for (const roleId of roleIds) {
        for (const permissionId of permIds) {
          const key = `${roleId}:${permissionId}`;
          if (linkSet.has(key)) continue;
          const row = {};
          row[roleIdCol] = roleId;
          row[permIdCol] = permissionId;
          linkRows.push(row);
        }
      }

      if (linkRows.length > 0) {
        await queryInterface.bulkInsert('role_permissions', linkRows, { transaction });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const slugs = ['route:marketing', 'action:marketing_manage'];
      const placeholders = slugs.map(() => '?').join(',');
      const [permRows] = await queryInterface.sequelize.query(
        `SELECT id FROM permissions WHERE slug IN (${placeholders})`,
        { replacements: slugs, transaction }
      );
      const permIds = Array.isArray(permRows) ? permRows.map((r) => r.id).filter((id) => id != null) : [];
      if (permIds.length === 0) return;

      let rpDesc;
      try {
        rpDesc = await queryInterface.describeTable('role_permissions');
      } catch {
        rpDesc = null;
      }
      const permIdCol = rpDesc && Object.prototype.hasOwnProperty.call(rpDesc, 'permissionId')
        ? 'permissionId'
        : rpDesc && Object.prototype.hasOwnProperty.call(rpDesc, 'permission_id')
          ? 'permission_id'
          : null;
      if (!permIdCol) return;

      const permPlaceholders = permIds.map(() => '?').join(',');
      await queryInterface.sequelize.query(
        `DELETE FROM role_permissions WHERE ${permIdCol} IN (${permPlaceholders})`,
        { replacements: permIds, transaction }
      );
    });
  },
};


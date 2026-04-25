import dotenv from 'dotenv';
import sequelize from '../config/database';
import '../models';
import { QueryTypes } from 'sequelize';
import { Permission, Role, RolePermission, Tenant, User, UserRole, UserTenant } from '../models';
import { SYSTEM_ROLE_NAMES, TENANT_DEFAULT_ROLE_SPECS } from '../constants/systemRoles';

dotenv.config();

async function syncDb() {
  try {
    console.log('⏳ Testing database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connected successfully.\n');

    const hasTenantIdCol = await sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'roles'
         AND COLUMN_NAME = 'tenant_id'
       LIMIT 1`,
      { type: QueryTypes.SELECT }
    );
    if ((hasTenantIdCol as any[]).length === 0) {
      await sequelize.query(`ALTER TABLE roles ADD COLUMN tenant_id INT NULL`);
    }

    const hasTenantLimitCol = await sequelize.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'tenants'
         AND COLUMN_NAME = 'sub_brand_limit'
       LIMIT 1`,
      { type: QueryTypes.SELECT }
    );
    if ((hasTenantLimitCol as any[]).length === 0) {
      await sequelize.query(`ALTER TABLE tenants ADD COLUMN sub_brand_limit INT NULL DEFAULT NULL`);
    }

    const nameIndexRows = await sequelize.query(
      `SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex, COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'roles'
         AND COLUMN_NAME IN ('name', 'tenant_id')`,
      { type: QueryTypes.SELECT }
    );

    const byIndex = new Map<string, { nonUnique: number; columns: string[] }>();
    for (const row of nameIndexRows as any[]) {
      const indexName = String(row.indexName);
      const nonUnique = Number(row.nonUnique);
      const seq = Number(row.seqInIndex);
      const col = String(row.columnName);
      const existing = byIndex.get(indexName) ?? { nonUnique, columns: [] };
      existing.nonUnique = nonUnique;
      existing.columns[seq - 1] = col;
      byIndex.set(indexName, existing);
    }

    for (const [indexName, info] of byIndex.entries()) {
      if (indexName === 'PRIMARY') continue;
      const isUnique = info.nonUnique === 0;
      const cols = info.columns.filter(Boolean);
      if (isUnique && cols.length === 1 && cols[0] === 'name') {
        await sequelize.query(`ALTER TABLE roles DROP INDEX \`${indexName}\``);
      }
    }

    const hasCompositeUnique = Array.from(byIndex.entries()).some(([indexName, info]) => {
      if (indexName === 'PRIMARY') return false;
      if (info.nonUnique !== 0) return false;
      const cols = info.columns.filter(Boolean);
      return cols.length === 2 && cols[0] === 'tenant_id' && cols[1] === 'name';
    });
    if (!hasCompositeUnique) {
      await sequelize.query(`ALTER TABLE roles ADD UNIQUE INDEX uniq_roles_tenant_name (tenant_id, name)`);
    }

    const allPerms = await Permission.findAll();
    const allPermBySlug = new Map<string, any>();
    for (const p of allPerms as any[]) {
      allPermBySlug.set(String(p.slug), p);
    }

    const legacyGlobals = await Role.findAll({
      where: { tenant_id: null } as any,
      include: [Permission],
    });
    const legacyByNameLower = new Map<string, any>();
    for (const r of legacyGlobals as any[]) {
      const k = String(r?.name ?? '').toLowerCase();
      if (!k) continue;
      if (!legacyByNameLower.has(k)) legacyByNameLower.set(k, r);
    }

    const tenants = await Tenant.findAll({ attributes: ['id'], order: [['id', 'ASC']] });

    const specByNameLower = new Map<string, { permissions: string[] }>();
    for (const spec of TENANT_DEFAULT_ROLE_SPECS) {
      specByNameLower.set(String(spec.name).toLowerCase(), { permissions: spec.permissions });
    }

    const getDesiredPermissionsForRoleName = (roleName: string): any[] => {
      const spec = specByNameLower.get(String(roleName).toLowerCase());
      if (!spec) return allPerms as any[];

      if (Array.isArray(spec.permissions) && spec.permissions.includes('*')) {
        return allPerms as any[];
      }

      const unique = Array.from(new Set((spec.permissions || []).map((x) => String(x))));
      return unique.map((s) => allPermBySlug.get(s)).filter(Boolean);
    };

    for (const tenant of tenants as any[]) {
      const operatorPerms = getDesiredPermissionsForRoleName(SYSTEM_ROLE_NAMES.operator);
      const staffPerms = getDesiredPermissionsForRoleName(SYSTEM_ROLE_NAMES.staff);
      const agentPerms = getDesiredPermissionsForRoleName(SYSTEM_ROLE_NAMES.agent);

      const [operatorRole] = await Role.findOrCreate({
        where: { tenant_id: tenant.id, name: SYSTEM_ROLE_NAMES.operator } as any,
        defaults: { tenant_id: tenant.id, name: SYSTEM_ROLE_NAMES.operator, description: 'Full system access', isSystem: false } as any,
      });
      await (operatorRole as any).setPermissions(operatorPerms);

      const [staffRole] = await Role.findOrCreate({
        where: { tenant_id: tenant.id, name: SYSTEM_ROLE_NAMES.staff } as any,
        defaults: { tenant_id: tenant.id, name: SYSTEM_ROLE_NAMES.staff, description: 'Read-only access', isSystem: false } as any,
      });
      await (staffRole as any).setPermissions(staffPerms);

      const [agentRole] = await Role.findOrCreate({
        where: { tenant_id: tenant.id, name: SYSTEM_ROLE_NAMES.agent } as any,
        defaults: { tenant_id: tenant.id, name: SYSTEM_ROLE_NAMES.agent, description: 'Agent access', isSystem: false } as any,
      });
      await (agentRole as any).setPermissions(agentPerms);
    }

    const userTenantRows = await UserTenant.findAll({ attributes: ['userId', 'tenantId'] } as any);
    const agentRoleByTenant = new Map<number, any>();
    for (const row of userTenantRows as any[]) {
      const tid = Number(row.tenantId ?? null);
      const uid = Number(row.userId ?? null);
      if (!Number.isFinite(tid) || tid <= 0) continue;
      if (!Number.isFinite(uid) || uid <= 0) continue;

      let agentRole = agentRoleByTenant.get(tid);
      if (!agentRole) {
        agentRole = await Role.findOne({ where: { tenant_id: tid, name: 'Agent' } as any });
        if (agentRole) agentRoleByTenant.set(tid, agentRole);
      }
      if (!agentRole) continue;
      await UserRole.findOrCreate({ where: { userId: uid, roleId: (agentRole as any).id } as any });
    }

    const globalSuperAdmin = legacyByNameLower.get('super admin');
    if (globalSuperAdmin) {
      await (globalSuperAdmin as any).setPermissions(allPerms);
    }

    const globalAgent = legacyByNameLower.get('agent');
    if (globalAgent) {
      const agentUserRoleRows = await UserRole.findAll({
        where: { roleId: globalAgent.id } as any,
        attributes: ['userId', 'roleId'],
      });
      for (const ur of agentUserRoleRows as any[]) {
        const user = await User.findByPk(ur.userId, { attributes: ['id', 'tenant_id'] } as any);
        if (!user) continue;

        const tenantIds = new Set<number>();
        const baseTid = Number((user as any).tenant_id ?? null);
        if (Number.isFinite(baseTid) && baseTid > 0) tenantIds.add(baseTid);

        const rows = await UserTenant.findAll({ where: { userId: user.id } as any, attributes: ['tenantId'] });
        for (const r of rows as any[]) {
          const tid = Number(r.tenantId ?? null);
          if (Number.isFinite(tid) && tid > 0) tenantIds.add(tid);
        }

        for (const tid of Array.from(tenantIds)) {
          const tenantAgentRole = await Role.findOne({ where: { tenant_id: tid, name: 'Agent' } as any });
          if (!tenantAgentRole) continue;
          await UserRole.findOrCreate({ where: { userId: user.id, roleId: (tenantAgentRole as any).id } as any });
        }
      }
      await UserRole.destroy({ where: { roleId: globalAgent.id } as any });
    }

    const remainingGlobals = await Role.findAll({ where: { tenant_id: null } as any });
    for (const r of remainingGlobals as any[]) {
      const nameLower = String(r?.name ?? '').toLowerCase();
      if (nameLower === 'super admin') continue;

      const userTenantRows = await sequelize.query(
        `SELECT DISTINCT u.tenant_id AS tenantId
         FROM user_roles ur
         JOIN users u ON u.id = ur.userId
         WHERE ur.roleId = :roleId
           AND u.tenant_id IS NOT NULL`,
        { type: QueryTypes.SELECT, replacements: { roleId: r.id } }
      );

      const tenantIds = (userTenantRows as any[])
        .map((x) => Number(x.tenantId))
        .filter((x) => Number.isFinite(x) && x > 0);

      if (tenantIds.length === 0) {
        continue;
      }

      if (tenantIds.length === 1) {
        const tid = tenantIds[0];
        const conflict = await Role.findOne({ where: { tenant_id: tid, name: r.name } as any });
        if (!conflict) {
          await (r as any).update({ tenant_id: tid, isSystem: false });
          continue;
        }
      }

      const legacyPerms = await (r as any).getPermissions();
      for (const tid of tenantIds) {
        const [targetRole] = await Role.findOrCreate({
          where: { tenant_id: tid, name: r.name } as any,
          defaults: { tenant_id: tid, name: r.name, description: r.description, isSystem: false } as any,
        });
        await (targetRole as any).setPermissions(legacyPerms);

        await sequelize.query(
          `INSERT IGNORE INTO user_roles (userId, roleId)
           SELECT ur.userId, :newRoleId
           FROM user_roles ur
           JOIN users u ON u.id = ur.userId
           WHERE ur.roleId = :oldRoleId
             AND u.tenant_id = :tenantId`,
          { replacements: { newRoleId: (targetRole as any).id, oldRoleId: r.id, tenantId: tid } }
        );
        await sequelize.query(
          `DELETE ur
           FROM user_roles ur
           JOIN users u ON u.id = ur.userId
           WHERE ur.roleId = :oldRoleId
             AND u.tenant_id = :tenantId`,
          { replacements: { oldRoleId: r.id, tenantId: tid } }
        );
      }

      const stillUsed = await UserRole.count({ where: { roleId: r.id } as any });
      if (stillUsed === 0) {
        await RolePermission.destroy({ where: { roleId: r.id } as any });
        await (r as any).destroy();
      }
    }

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

syncDb();

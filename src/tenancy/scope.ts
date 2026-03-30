import { AuthRequest } from '../middleware/auth';

export type TenancyScope = {
  tenant_id: number;
  sub_brand_id: number;
};

export const getTenancyScopeOrThrow = (req: AuthRequest): TenancyScope => {
  const tenantId = Number(req.user?.tenant_id);
  const subBrandId = Number(req.user?.sub_brand_id);
  if (!Number.isFinite(tenantId) || tenantId <= 0 || !Number.isFinite(subBrandId) || subBrandId <= 0) {
    throw new Error('TENANCY_SCOPE_MISSING');
  }
  return { tenant_id: tenantId, sub_brand_id: subBrandId };
};

export const withTenancyWhere = (scope: TenancyScope, where: any = {}) => {
  return { ...where, tenant_id: scope.tenant_id, sub_brand_id: scope.sub_brand_id };
};

export const withTenancyCreate = (scope: TenancyScope, payload: any = {}) => {
  return { ...payload, tenant_id: scope.tenant_id, sub_brand_id: scope.sub_brand_id };
};


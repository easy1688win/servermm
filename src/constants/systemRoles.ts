export const SYSTEM_ROLE_NAMES = {
  superAdmin: "Super Admin",
  operator: "Operator",
  staff: "Staff",
} as const;

export const SYSTEM_ROLE_DESCRIPTIONS = {
  superAdmin: "Full access to all",
  operator: "Full system access",
  staff: "Read-only access",
} as const;

export const RESERVED_ROLE_NAMES = new Set(
  Object.values(SYSTEM_ROLE_NAMES).map((x) => x.toLowerCase()),
);

export const normalizeRoleName = (name: unknown): string => {
  if (typeof name !== "string") return "";
  return name.trim();
};


export const SYSTEM_ROLE_NAMES = {
  superAdmin: "Super Admin",
  operator: "Operator",
  staff: "Staff",
  agent: "Agent",
} as const;

export const SYSTEM_ROLE_DESCRIPTIONS = {
  superAdmin: "Full access to all",
  operator: "Full system access",
  staff: "Read-only access",
  agent: "Agent access",
} as const;

export const RESERVED_ROLE_NAMES = new Set(
  Object.values(SYSTEM_ROLE_NAMES).map((x) => x.toLowerCase()),
);

export const normalizeRoleName = (name: unknown): string => {
  if (typeof name !== "string") return "";
  return name.trim();
};

export const GLOBAL_ROLE_SPECS: Array<{
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}> = [
  {
    name: SYSTEM_ROLE_NAMES.superAdmin,
    description: SYSTEM_ROLE_DESCRIPTIONS.superAdmin,
    isSystem: true,
    permissions: ["*"],
  },
];

export const TENANT_DEFAULT_ROLE_SPECS: Array<{
  name: string;
  description: string;
  permissions: string[];
}> = [
  {
    name: SYSTEM_ROLE_NAMES.operator,
    description: SYSTEM_ROLE_DESCRIPTIONS.operator,
    permissions: ["*"],
  },
  {
    name: SYSTEM_ROLE_NAMES.staff,
    description: SYSTEM_ROLE_DESCRIPTIONS.staff,
    permissions: [
      "route:dashboard",
      "view:dashboard_financials",
      "route:transactions",
      "route:transaction_history",
      "action:transaction_edit",
      "action:deposit_create",
      "action:bonus_create",
      "action:withdrawal_create",
      "action:burn_create",
      "route:banks",
      "view:bank_balance",
      "view:bank_full_account",
      "route:players",
      "view:player_profit",
      "view:player_banks",
      "action:player_create",
      "action:player_edit",
      "action:player_banks_edit",
      "route:reports",
      "route:reports:summary",
      "route:reports:player_winloss",
      "route:reports:game_log",
      "route:reports:kiosk",
      "route:users",
      "action:user_edit",
      "route:settings",
      "view:games",
      "view:player_metadata",
    ],
  },
  {
    name: SYSTEM_ROLE_NAMES.agent,
    description: SYSTEM_ROLE_DESCRIPTIONS.agent,
    permissions: [
      "route:dashboard",
      "view:dashboard_financials",
      "route:reports",
      "route:reports:subbrand_winloss",
      "route:audit",
      "view:audit_logs",
      "route:users",
      "action:user_view",
      "action:user_create",
      "action:user_edit",
      "action:user_delete",
      "action:user_api_manage",
      "action:role_view",
      "action:role_manage",
      "view:player_metadata",
      "view:games",
      "action:game_operational",
      "action:game_adjust_balance",
      "view:device_sessions",
      "action:device_session_revoke",
      "action:device_fingerprint_lock",
      "action:settings_manage",
      "route:settings",
      "action:security_manage",
      'view:system_settings',
      'view:bank_catalog',
    ],
  },
];


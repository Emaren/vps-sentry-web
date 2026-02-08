export const RBAC_ROLE_ORDER = ["viewer", "ops", "admin", "owner"] as const;

export type AppRole = (typeof RBAC_ROLE_ORDER)[number];

export type RoleCapability = "read" | "mutate" | "ops" | "admin" | "owner";

const ROLE_RANK: Record<AppRole, number> = {
  viewer: 1,
  ops: 2,
  admin: 3,
  owner: 4,
};

const CAPABILITY_MIN_ROLE: Record<RoleCapability, AppRole> = {
  read: "viewer",
  mutate: "admin",
  ops: "ops",
  admin: "admin",
  owner: "owner",
};

export const DEFAULT_APP_ROLE: AppRole = "viewer";

export function normalizeAppRole(raw: unknown): AppRole | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (t === "viewer" || t === "ops" || t === "admin" || t === "owner") {
    return t;
  }
  return null;
}

export function roleRank(role: AppRole): number {
  return ROLE_RANK[role];
}

export function hasRequiredRole(currentRole: AppRole | null | undefined, requiredRole: AppRole): boolean {
  if (!currentRole) return false;
  return roleRank(currentRole) >= roleRank(requiredRole);
}

export function maxRole(a: AppRole, b: AppRole): AppRole {
  return hasRequiredRole(a, b) ? a : b;
}

export function roleCan(role: AppRole | null | undefined, capability: RoleCapability): boolean {
  return hasRequiredRole(role, CAPABILITY_MIN_ROLE[capability]);
}

export function roleLabel(role: AppRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

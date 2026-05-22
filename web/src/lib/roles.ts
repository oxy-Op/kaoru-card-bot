import type { AdminRole } from "./auth";

const ROLE_LEVELS: Record<AdminRole, number> = {
  viewer: 1,
  curator: 2,
  admin: 3,
  owner: 4,
};

export function roleLevel(role: string): number {
  return ROLE_LEVELS[role as AdminRole] ?? 0;
}

export function hasRole(userRole: string, requiredRole: AdminRole): boolean {
  return roleLevel(userRole) >= roleLevel(requiredRole);
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  owner: "Owner",
  admin: "Admin",
  curator: "Curator",
  viewer: "Viewer",
};

export const ROLE_COLORS: Record<AdminRole, string> = {
  owner: "text-amber-400",
  admin: "text-blue-400",
  curator: "text-green-400",
  viewer: "text-zinc-400",
};

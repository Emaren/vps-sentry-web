import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_APP_ROLE,
  hasRequiredRole,
  maxRole,
  normalizeAppRole,
  type AppRole,
} from "@/lib/rbac-policy";

const DEFAULT_OWNER_EMAILS = ["tonyblumdev@gmail.com"];

export type AccessStatus = 401 | 403;

export type AccessIdentity = {
  userId: string;
  email: string;
  role: AppRole;
  roleSource: "db" | "env-bootstrap" | "default";
};

export type RoleAccessResult =
  | {
      ok: true;
      identity: AccessIdentity;
    }
  | {
      ok: false;
      status: AccessStatus;
      error: string;
      email?: string;
      role?: AppRole | null;
      requiredRole: AppRole;
    };

export type AdminIdentity = AccessIdentity;
export type AdminAccessResult = RoleAccessResult;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseList(raw?: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/\n|,|\|\|/g)) {
    const t = normalizeEmail(part);
    if (t) out.push(t);
  }
  return out;
}

function uniqueEmails(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function readOwnerAllowlist(): string[] {
  const fromEnv = parseList(process.env.VPS_OWNER_EMAILS);
  if (fromEnv.length > 0) return uniqueEmails(fromEnv);
  return uniqueEmails(DEFAULT_OWNER_EMAILS);
}

export function readAdminAllowlist(): string[] {
  return uniqueEmails([
    ...parseList(process.env.VPS_ADMIN_EMAILS),
    ...parseList(process.env.VPS_ADMIN_EMAIL),
  ]);
}

export function readOpsAllowlist(): string[] {
  return uniqueEmails(parseList(process.env.VPS_OPS_EMAILS));
}

export function readViewerAllowlist(): string[] {
  return uniqueEmails(parseList(process.env.VPS_VIEWER_EMAILS));
}

export function resolveBootstrapRoleForEmail(email?: string | null): AppRole | null {
  if (!email) return null;
  const normalized = normalizeEmail(email);
  if (readOwnerAllowlist().includes(normalized)) return "owner";
  if (readAdminAllowlist().includes(normalized)) return "admin";
  if (readOpsAllowlist().includes(normalized)) return "ops";
  if (readViewerAllowlist().includes(normalized)) return "viewer";
  return null;
}

export function isAdminEmail(email?: string | null): boolean {
  const role = resolveBootstrapRoleForEmail(email);
  return hasRequiredRole(role, "admin");
}

function isMissingRoleColumnError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes("p2022") ||
    (lower.includes("column") && lower.includes("role")) ||
    lower.includes("unknown field") ||
    lower.includes("unknown arg") ||
    lower.includes("unknown argument")
  );
}

async function findUserByEmail(email: string): Promise<{
  id: string;
  email: string;
  role: AppRole | null;
} | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true },
    });
    if (!user?.email) return null;
    return {
      id: user.id,
      email: user.email,
      role: normalizeAppRole(user.role),
    };
  } catch (err: unknown) {
    if (!isMissingRoleColumnError(err)) throw err;

    // Transitional fallback while DB migration is being rolled out.
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (!user?.email) return null;
    return {
      id: user.id,
      email: user.email,
      role: null,
    };
  }
}

function forbiddenResult(requiredRole: AppRole, email: string, role: AppRole): RoleAccessResult {
  return {
    ok: false,
    status: 403,
    error: "Forbidden",
    email,
    role,
    requiredRole,
  };
}

export async function requireRoleAccess(requiredRole: AppRole): Promise<RoleAccessResult> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();

  if (!email) {
    return { ok: false, status: 401, error: "Unauthorized", requiredRole };
  }

  const user = await findUserByEmail(email);
  if (!user?.email) {
    return { ok: false, status: 401, error: "Unauthorized", email, requiredRole };
  }

  const dbRole = user.role ?? DEFAULT_APP_ROLE;
  const bootstrapRole = resolveBootstrapRoleForEmail(user.email);
  const effectiveRole = bootstrapRole ? maxRole(dbRole, bootstrapRole) : dbRole;
  const roleSource: AccessIdentity["roleSource"] =
    bootstrapRole && effectiveRole === bootstrapRole && bootstrapRole !== dbRole
      ? "env-bootstrap"
      : user.role
      ? "db"
      : "default";

  if (!hasRequiredRole(effectiveRole, requiredRole)) {
    return forbiddenResult(requiredRole, user.email, effectiveRole);
  }

  return {
    ok: true,
    identity: {
      userId: user.id,
      email: user.email,
      role: effectiveRole,
      roleSource,
    },
  };
}

export async function getCurrentAccessIdentity(): Promise<AccessIdentity | null> {
  const access = await requireRoleAccess("viewer");
  return access.ok ? access.identity : null;
}

export async function requireViewerAccess(): Promise<RoleAccessResult> {
  return requireRoleAccess("viewer");
}

export async function requireOpsAccess(): Promise<RoleAccessResult> {
  return requireRoleAccess("ops");
}

export async function requireAdminAccess(): Promise<AdminAccessResult> {
  return requireRoleAccess("admin");
}

export async function requireOwnerAccess(): Promise<RoleAccessResult> {
  return requireRoleAccess("owner");
}

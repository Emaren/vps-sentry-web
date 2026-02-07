import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const DEFAULT_ADMIN_EMAILS = ["tonyblumdev@gmail.com"];

export type AccessStatus = 401 | 403;

export type AdminIdentity = {
  userId: string;
  email: string;
};

export type AdminAccessResult =
  | {
      ok: true;
      identity: AdminIdentity;
    }
  | {
      ok: false;
      status: AccessStatus;
      error: string;
      email?: string;
    };

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

export function readAdminAllowlist(): string[] {
  const envPrimary = parseList(process.env.VPS_ADMIN_EMAILS);
  if (envPrimary.length) return envPrimary;

  const envLegacy = parseList(process.env.VPS_ADMIN_EMAIL);
  if (envLegacy.length) return envLegacy;

  return DEFAULT_ADMIN_EMAILS;
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  return readAdminAllowlist().includes(normalized);
}

export async function requireAdminAccess(): Promise<AdminAccessResult> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();

  if (!email) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (!isAdminEmail(email)) {
    return { ok: false, status: 403, error: "Forbidden", email };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (!user?.email) {
    return { ok: false, status: 401, error: "Unauthorized", email };
  }

  return {
    ok: true,
    identity: {
      userId: user.id,
      email: user.email,
    },
  };
}

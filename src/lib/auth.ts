// /var/www/vps-sentry-web/src/lib/auth.ts
import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import { prisma } from "@/lib/prisma";

/**
 * IMPORTANT: Do NOT throw during module import.
 * Build/env/systemd contexts differ; keep `pnpm build` resilient.
 */

function envTrim(key: string): string | undefined {
  const v = process.env[key];
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
}

function requiredEnv(key: string): string {
  const v = envTrim(key);
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function optionalEnv(key: string): string | undefined {
  return envTrim(key);
}

export function hasGoogleEnv(): boolean {
  return Boolean(envTrim("GOOGLE_CLIENT_ID") && envTrim("GOOGLE_CLIENT_SECRET"));
}

/**
 * Email can be configured either as:
 *  A) EMAIL_SERVER="smtp://user:pass@host:587" + EMAIL_FROM
 *  B) EMAIL_SERVER_HOST/PORT/USER/PASSWORD + EMAIL_FROM
 */
export function hasEmailEnv(): boolean {
  const from = envTrim("EMAIL_FROM");
  if (!from) return false;

  // Option A (URL)
  if (envTrim("EMAIL_SERVER")) return true;

  // Option B (pieces)
  return Boolean(
    envTrim("EMAIL_SERVER_HOST") &&
      envTrim("EMAIL_SERVER_PORT") &&
      envTrim("EMAIL_SERVER_USER") &&
      envTrim("EMAIL_SERVER_PASSWORD")
  );
}

const debugEnabled =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXTAUTH_DEBUG === "true" ||
    process.env.NEXTAUTH_DEBUG === "1" ||
    (process.env.DEBUG?.includes("next-auth") ?? false));

// Next build sets NEXT_PHASE=phase-production-build
const isBuildTime =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

type EmailServerConfig =
  | string
  | {
      host: string;
      port: number;
      auth?: { user: string; pass: string };
      secure?: boolean;
    };

function buildEmailServerFromUrl(urlStr: string): EmailServerConfig | null {
  try {
    // Accept smtp://user:pass@host:port or smtps://...
    const u = new URL(urlStr);
    const protocol = (u.protocol || "").replace(":", "");
    const host = u.hostname;
    const port = u.port ? Number(u.port) : protocol === "smtps" ? 465 : 587;

    if (!host) return null;
    if (!Number.isFinite(port) || port <= 0) return null;

    const user = u.username ? decodeURIComponent(u.username) : "";
    const pass = u.password ? decodeURIComponent(u.password) : "";

    const secure = protocol === "smtps" || port === 465;

    const cfg: EmailServerConfig = {
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    };

    return cfg;
  } catch {
    return null;
  }
}

function buildProviders() {
  const providers: NextAuthOptions["providers"] = [];

  // ---- Magic Link (Email) ----
  if (hasEmailEnv()) {
    const from = requiredEnv("EMAIL_FROM");

    // Prefer URL form if present
    const serverUrl = envTrim("EMAIL_SERVER");
    if (serverUrl) {
      const server = buildEmailServerFromUrl(serverUrl);
      if (server) {
        providers.push(
          EmailProvider({
            server,
            from,
            maxAge: 15 * 60, // 15 minutes
          })
        );
      } else if (!isBuildTime && process.env.NODE_ENV === "production") {
        console.warn(
          "[next-auth] Email provider NOT enabled (EMAIL_SERVER present but could not be parsed)."
        );
      }
    } else {
      // Fallback to split vars
      const host = requiredEnv("EMAIL_SERVER_HOST");

      const portRaw = requiredEnv("EMAIL_SERVER_PORT");
      const port = Number(portRaw);
      if (!Number.isFinite(port) || port <= 0) {
        // keep runtime error (not import-time), but do not blow up builds
        if (isBuildTime) {
          console.warn(`[next-auth] Invalid EMAIL_SERVER_PORT during build: ${portRaw}`);
        } else {
          throw new Error(`Invalid EMAIL_SERVER_PORT: ${portRaw}`);
        }
      } else {
        const user = requiredEnv("EMAIL_SERVER_USER");
        const pass = requiredEnv("EMAIL_SERVER_PASSWORD");

        providers.push(
          EmailProvider({
            server: {
              host,
              port,
              secure: port === 465, // 465=SMTPS, 587=STARTTLS
              auth: { user, pass },
            },
            from,
            maxAge: 15 * 60, // 15 minutes
          })
        );
      }
    }
  } else if (!isBuildTime && process.env.NODE_ENV === "production") {
    console.warn(
      "[next-auth] Email provider NOT enabled (missing EMAIL_SERVER or EMAIL_SERVER_* and/or EMAIL_FROM)."
    );
  }

  // ---- Google OAuth (optional) ----
  if (hasGoogleEnv()) {
    providers.push(
      GoogleProvider({
        clientId: requiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      })
    );
  } else if (!isBuildTime && process.env.NODE_ENV === "production") {
    console.warn("[next-auth] Google provider NOT enabled (missing GOOGLE_CLIENT_* env).");
  }

  return providers;
}

/**
 * Patch: swallow Prisma "record not found" on deleteSession.
 * This fixes magic-link callbacks failing with:
 *   CALLBACK_EMAIL_ERROR DeleteSessionError / P2025
 */
function isPrismaRecordNotFound(e: unknown): boolean {
  const maybeErr = e as { code?: unknown };
  return maybeErr?.code === "P2025";
}

const baseAdapter = PrismaAdapter(prisma) as Adapter;

const patchedAdapter: Adapter = {
  ...baseAdapter,
  async deleteSession(sessionToken: string): Promise<void> {
    // NextAuth expects: deleting a missing session should not be fatal.
    if (!baseAdapter.deleteSession) return;
    try {
      await baseAdapter.deleteSession(sessionToken);
    } catch (e) {
      if (isPrismaRecordNotFound(e)) return;
      throw e;
    }
  },
};

export const authOptions: NextAuthOptions = {
  // ✅ don't hard-require at module load (keeps build resilient)
  secret: process.env.NEXTAUTH_SECRET,

  debug: debugEnabled,

  adapter: patchedAdapter,
  session: { strategy: "database" },

  providers: buildProviders(),

  pages: {
    signIn: "/login",
    error: "/login",
    verifyRequest: "/login",
  },

  logger: {
    error(code, metadata) {
      console.error("[next-auth][error]", code, metadata ?? "");
    },
    warn(code) {
      console.warn("[next-auth][warn]", code);
    },
    debug(code, metadata) {
      if (!debugEnabled) return;
      console.log("[next-auth][debug]", code, metadata ?? "");
    },
  },

  events: {
    signIn(message) {
      console.log("[next-auth][event:signIn]", message);
    },
    signOut(message) {
      console.log("[next-auth][event:signOut]", message);
    },
    session(message) {
      console.log("[next-auth][event:session]", message);
    },
  },

  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
  },
};

// ✅ never throw here; safe for build/debug screens
export const authEnv = {
  NEXTAUTH_SECRET: optionalEnv("NEXTAUTH_SECRET") ? "[set]" : undefined,
  NEXTAUTH_URL: optionalEnv("NEXTAUTH_URL"),

  GOOGLE_CLIENT_ID: optionalEnv("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: optionalEnv("GOOGLE_CLIENT_SECRET") ? "[set]" : undefined,

  // URL form (preferred in your systemd file)
  EMAIL_SERVER: optionalEnv("EMAIL_SERVER") ? "[set]" : undefined,

  // split form (optional)
  EMAIL_SERVER_HOST: optionalEnv("EMAIL_SERVER_HOST"),
  EMAIL_SERVER_PORT: optionalEnv("EMAIL_SERVER_PORT"),
  EMAIL_SERVER_USER: optionalEnv("EMAIL_SERVER_USER"),
  EMAIL_SERVER_PASSWORD: optionalEnv("EMAIL_SERVER_PASSWORD") ? "[set]" : undefined,
  EMAIL_FROM: optionalEnv("EMAIL_FROM"),
};

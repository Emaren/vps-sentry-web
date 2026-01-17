// /var/www/vps-sentry-web/src/lib/auth.ts
import type { NextAuthOptions } from "next-auth";
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

export function hasEmailEnv(): boolean {
  return Boolean(
    envTrim("EMAIL_SERVER_HOST") &&
      envTrim("EMAIL_SERVER_PORT") &&
      envTrim("EMAIL_SERVER_USER") &&
      envTrim("EMAIL_SERVER_PASSWORD") &&
      envTrim("EMAIL_FROM")
  );
}

const debugEnabled =
  process.env.NEXTAUTH_DEBUG === "true" ||
  process.env.NEXTAUTH_DEBUG === "1" ||
  (process.env.DEBUG?.includes("next-auth") ?? false);

// Next build sets NEXT_PHASE=phase-production-build
const isBuildTime =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

function buildProviders() {
  const providers: any[] = [];

  // ---- Magic Link (Email) ----
  if (hasEmailEnv()) {
    const host = requiredEnv("EMAIL_SERVER_HOST");

    const portRaw = requiredEnv("EMAIL_SERVER_PORT");
    const port = Number(portRaw);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`Invalid EMAIL_SERVER_PORT: ${portRaw}`);
    }

    const user = requiredEnv("EMAIL_SERVER_USER");
    const pass = requiredEnv("EMAIL_SERVER_PASSWORD");
    const from = requiredEnv("EMAIL_FROM");

    // ✅ DO NOT override template: keep NextAuth default email HTML
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
  } else if (!isBuildTime && process.env.NODE_ENV === "production") {
    console.warn(
      "[next-auth] Email provider NOT enabled (missing EMAIL_SERVER_* and/or EMAIL_FROM)."
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

export const authOptions: NextAuthOptions = {
  // ✅ don't hard-require at module load (keeps build resilient)
  secret: process.env.NEXTAUTH_SECRET,

  debug: debugEnabled,

  adapter: PrismaAdapter(prisma),
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

  EMAIL_SERVER_HOST: optionalEnv("EMAIL_SERVER_HOST"),
  EMAIL_SERVER_PORT: optionalEnv("EMAIL_SERVER_PORT"),
  EMAIL_SERVER_USER: optionalEnv("EMAIL_SERVER_USER"),
  EMAIL_SERVER_PASSWORD: optionalEnv("EMAIL_SERVER_PASSWORD") ? "[set]" : undefined,
  EMAIL_FROM: optionalEnv("EMAIL_FROM"),
};

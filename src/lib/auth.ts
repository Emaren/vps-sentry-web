// /var/www/vps-sentry-web/src/lib/auth.ts
import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import { prisma } from "@/lib/prisma";

function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v || !v.trim()) throw new Error(`Missing env var: ${key}`);
  return v.trim();
}

function optionalEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : undefined;
}

export function hasGoogleEnv(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function hasEmailEnv(): boolean {
  return Boolean(
    process.env.EMAIL_SERVER_HOST?.trim() &&
      process.env.EMAIL_SERVER_PORT?.trim() &&
      process.env.EMAIL_SERVER_USER?.trim() &&
      process.env.EMAIL_SERVER_PASSWORD?.trim() &&
      process.env.EMAIL_FROM?.trim()
  );
}

const debugEnabled =
  process.env.NEXTAUTH_DEBUG === "true" ||
  (process.env.DEBUG?.includes("next-auth") ?? false);

function buildProviders() {
  const providers: any[] = [];

  // ---- Magic Link (Email) ----
  if (hasEmailEnv()) {
    const host = requiredEnv("EMAIL_SERVER_HOST");
    const port = Number(requiredEnv("EMAIL_SERVER_PORT"));
    const user = requiredEnv("EMAIL_SERVER_USER");
    const pass = requiredEnv("EMAIL_SERVER_PASSWORD");
    const from = requiredEnv("EMAIL_FROM");

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
  } else {
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
  } else {
    console.warn("[next-auth] Google provider NOT enabled (missing GOOGLE_CLIENT_* env).");
  }

  return providers;
}

export const authOptions: NextAuthOptions = {
  secret: requiredEnv("NEXTAUTH_SECRET"),
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

export const authEnv = {
  NEXTAUTH_SECRET: requiredEnv("NEXTAUTH_SECRET"),
  NEXTAUTH_URL: requiredEnv("NEXTAUTH_URL"),

  GOOGLE_CLIENT_ID: optionalEnv("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: optionalEnv("GOOGLE_CLIENT_SECRET"),

  EMAIL_SERVER_HOST: optionalEnv("EMAIL_SERVER_HOST"),
  EMAIL_SERVER_PORT: optionalEnv("EMAIL_SERVER_PORT"),
  EMAIL_SERVER_USER: optionalEnv("EMAIL_SERVER_USER"),
  EMAIL_FROM: optionalEnv("EMAIL_FROM"),
};

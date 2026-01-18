// /var/www/vps-sentry-web/src/lib/server-base-url.ts
import { headers } from "next/headers";

/**
 * Derive the public base URL behind nginx/proxy.
 * Falls back to NEXTAUTH_URL, then local dev.
 */
export async function getBaseUrlFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return process.env.NEXTAUTH_URL ?? "http://127.0.0.1:3035";
}

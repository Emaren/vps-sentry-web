// /var/www/vps-sentry-web/src/lib/public-url.ts

function envTrim(key: string): string | null {
  const v = process.env[key]?.trim();
  return v && v.length ? v : null;
}

function normalizeUrl(raw: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  const lower = raw.toLowerCase();
  const isLocal =
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("0.0.0.0");

  return `${isLocal ? "http" : "https"}://${raw}`;
}

export function inferPublicBaseUrl(req?: Request): string | null {
  // Prefer explicit config first
  const raw =
    envTrim("APP_URL") ??
    envTrim("NEXTAUTH_URL") ??
    envTrim("VERCEL_URL");

  if (raw) return normalizeUrl(raw);

  // Otherwise infer from request headers (behind nginx/proxy)
  if (!req) return null;

  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "";

  if (!host) return null;

  const proto =
    req.headers.get("x-forwarded-proto") ||
    (host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`;
}

export function urlFromBase(baseUrl: string | null, path: string): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return null;
  }
}

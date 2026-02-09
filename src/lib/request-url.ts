// /var/www/vps-sentry-web/src/lib/request-url.ts
// Never throw on weird build-worker Request objects.
// Always return a usable URL.

const RAW_BASE =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost";

function normalizeBase(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "http://localhost";

  // If already absolute, keep it
  try {
    return new URL(s).toString();
  } catch {
    // If missing scheme, try https then http
    try {
      return new URL(`https://${s}`).toString();
    } catch {
      try {
        return new URL(`http://${s}`).toString();
      } catch {
        return "http://localhost";
      }
    }
  }
}

const FALLBACK_BASE = normalizeBase(RAW_BASE);

function isBadUrlString(v: unknown): boolean {
  if (typeof v !== "string") return true;
  const s = v.trim();
  if (!s) return true;
  if (s === "[object Object]") return true;
  return false;
}

type ReqLike = {
  url?: unknown;
  nextUrl?: {
    href?: unknown;
    pathname?: unknown;
    search?: unknown;
  };
};

function pickCandidateUrl(req: unknown): string {
  const reqLike = (req && typeof req === "object" ? req : null) as ReqLike | null;

  // 1) req.url
  const raw = reqLike?.url;
  if (!isBadUrlString(raw)) return String(raw).trim();

  // 2) req.nextUrl?.href
  const href = reqLike?.nextUrl?.href;
  if (!isBadUrlString(href)) return String(href).trim();

  // 3) req.nextUrl?.pathname + search
  const pathname = reqLike?.nextUrl?.pathname;
  if (!isBadUrlString(pathname)) {
    const search =
      typeof reqLike?.nextUrl?.search === "string" ? reqLike.nextUrl.search : "";
    return `${String(pathname).trim()}${search}`;
  }

  // 4) If someone passed a string/URL directly to safeRequestUrl
  if (!isBadUrlString(req)) return String(req).trim();
  if (req instanceof URL) return req.toString();

  return "/";
}

function toAbsoluteUrlString(candidate: string): string {
  const s = String(candidate ?? "/").trim() || "/";
  if (s === "[object Object]") return new URL("/", FALLBACK_BASE).toString();

  // Absolute?
  try {
    return new URL(s).toString();
  } catch {
    // Relative -> base
    try {
      return new URL(s, FALLBACK_BASE).toString();
    } catch {
      return new URL("/", FALLBACK_BASE).toString();
    }
  }
}

/**
 * Safe URL parser. Never throws.
 * Works with Request, NextRequest, or "weird" build-worker request-like objects.
 */
export function safeRequestUrl(req: unknown): URL {
  const candidate = pickCandidateUrl(req);
  const abs = toAbsoluteUrlString(candidate);
  return new URL(abs);
}

/**
 * Safe URL string. Never throws.
 */
export function safeRequestUrlString(req: unknown): string {
  return safeRequestUrl(req).toString();
}

/**
 * Useful when you only need origin (scheme://host).
 */
export function safeRequestOrigin(req: unknown): string {
  return safeRequestUrl(req).origin;
}

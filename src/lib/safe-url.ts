const DEFAULT_BASE =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXTAUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "http://localhost:3000";

function hasScheme(s: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(s);
}

/**
 * coerceUrlString()
 * Strict helper for places where you still want `new URL(...)` to THROW on bad input,
 * but you want to gracefully handle objects like { href }, { url }, URL, NextUrl-like, etc.
 */
export function coerceUrlString(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (input instanceof URL) return input.toString();

  if (input && typeof input === "object") {
    const any = input as any;
    if (typeof any.href === "string") return any.href.trim();
    if (typeof any.url === "string") return any.url.trim();
  }

  const s = String(input ?? "").trim();
  if (!s || s === "[object Object]" || s === "undefined" || s === "null") return "";
  return s;
}

/**
 * safeURL()
 * Lenient helper for app URLs (never throws).
 */
export function safeURL(input: unknown, base: string = DEFAULT_BASE): URL {
  if (input instanceof URL) return input;

  const s0 = coerceUrlString(input);
  const s = s0.trim();

  if (!s) return new URL("/", base);

  try {
    return new URL(s);
  } catch {}

  if (s.startsWith("//")) {
    try {
      return new URL(`https:${s}`);
    } catch {}
  }

  if (!hasScheme(s)) {
    try {
      return new URL(`https://${s}`);
    } catch {}
  }

  try {
    return new URL(s, base);
  } catch {}

  return new URL("/", base);
}

export function safeURLString(input: unknown, base?: string) {
  return safeURL(input, base).toString();
}

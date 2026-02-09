const FALLBACK_BASE = "http://localhost";

function fromRawObject(raw: Record<string, unknown>): URL | null {
  const href = raw.href;
  if (typeof href === "string" && href.trim()) {
    try {
      return new URL(href);
    } catch {}
  }

  const pathname = raw.pathname;
  if (typeof pathname === "string" && pathname.trim()) {
    const search = typeof raw.search === "string" ? raw.search : "";
    try {
      return new URL(`${pathname}${search}`, FALLBACK_BASE);
    } catch {}
  }

  return null;
}

export function safeRequestUrl(req: { url?: unknown } | null | undefined): URL {
  const raw = req?.url;

  if (raw instanceof URL) return raw;

  if (typeof raw === "string") {
    try {
      return new URL(raw);
    } catch {
      if (raw.startsWith("/")) {
        return new URL(raw, FALLBACK_BASE);
      }
    }
  } else if (raw && typeof raw === "object") {
    const parsed = fromRawObject(raw as Record<string, unknown>);
    if (parsed) return parsed;
  }

  return new URL("/", FALLBACK_BASE);
}

import { NextRequest, NextResponse } from "next/server";

type RateLimitPolicy = {
  name: string;
  max: number;
  windowMs: number;
};

type RateLimitState = {
  key: string;
  policy: RateLimitPolicy;
  count: number;
  remaining: number;
  resetAt: number;
  limited: boolean;
};

type Bucket = {
  count: number;
  resetAt: number;
};

type GlobalRateStore = {
  store: Map<string, Bucket>;
  lastSweepAt: number;
};

const RATE_WINDOW_MS = 60_000;
const RATE_SWEEP_INTERVAL_MS = 30_000;

function getRateStore(): GlobalRateStore {
  const g = globalThis as unknown as { __vpsRateLimit?: GlobalRateStore };
  if (!g.__vpsRateLimit) {
    g.__vpsRateLimit = {
      store: new Map<string, Bucket>(),
      lastSweepAt: Date.now(),
    };
  }
  return g.__vpsRateLimit;
}

function maybeSweepRateStore(now: number) {
  const state = getRateStore();
  if (now - state.lastSweepAt < RATE_SWEEP_INTERVAL_MS) return;

  for (const [key, bucket] of state.store.entries()) {
    if (bucket.resetAt <= now) state.store.delete(key);
  }
  state.lastSweepAt = now;
}

function normalizeClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return "unknown";
}

function normalizeSessionHint(req: NextRequest): string {
  const sessionToken =
    req.cookies.get("__Secure-next-auth.session-token")?.value ||
    req.cookies.get("next-auth.session-token")?.value ||
    req.cookies.get("__Host-next-auth.session-token")?.value ||
    "";

  if (!sessionToken) return "anon";
  return sessionToken.slice(0, 16);
}

function selectRateLimitPolicy(req: NextRequest): RateLimitPolicy | null {
  const method = req.method.toUpperCase();
  const path = req.nextUrl.pathname;

  if (!path.startsWith("/api/")) return null;
  if (method === "OPTIONS" || method === "HEAD") return null;

  if (/^\/api\/auth\//.test(path) && method === "POST") {
    return { name: "auth-post", max: 45, windowMs: RATE_WINDOW_MS };
  }

  if (/^\/api\/hosts\/[^/]+\/status$/.test(path) && method === "POST") {
    return { name: "host-ingest", max: 240, windowMs: RATE_WINDOW_MS };
  }

  if (path === "/api/remediate" && method === "POST") {
    return { name: "remediate", max: 120, windowMs: RATE_WINDOW_MS };
  }

  if (path === "/api/notify/test" && method === "POST") {
    return { name: "notify-test", max: 20, windowMs: RATE_WINDOW_MS };
  }

  if (/^\/api\/ops\//.test(path) && method === "POST") {
    return { name: "ops-write", max: 30, windowMs: RATE_WINDOW_MS };
  }

  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    return { name: "api-write", max: 120, windowMs: RATE_WINDOW_MS };
  }

  return { name: "api-read", max: 900, windowMs: RATE_WINDOW_MS };
}

function evaluateRateLimit(req: NextRequest, policy: RateLimitPolicy): RateLimitState {
  const now = Date.now();
  maybeSweepRateStore(now);

  const ip = normalizeClientIp(req);
  const sessionHint = normalizeSessionHint(req);
  const method = req.method.toUpperCase();
  const path = req.nextUrl.pathname;
  const key = `${policy.name}:${method}:${path}:${ip}:${sessionHint}`;

  const state = getRateStore();
  const current = state.store.get(key);

  let bucket: Bucket;
  if (!current || current.resetAt <= now) {
    bucket = { count: 0, resetAt: now + policy.windowMs };
  } else {
    bucket = current;
  }

  bucket.count += 1;
  state.store.set(key, bucket);

  const limited = bucket.count > policy.max;
  const remaining = Math.max(0, policy.max - bucket.count);

  return {
    key,
    policy,
    count: bucket.count,
    remaining,
    resetAt: bucket.resetAt,
    limited,
  };
}

function getCspValue(): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https: wss:",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
  ];

  if (process.env.NODE_ENV === "production") {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

function applySecurityHeaders(req: NextRequest, res: NextResponse): void {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  res.headers.set("Origin-Agent-Cluster", "?1");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  res.headers.set("Content-Security-Policy", getCspValue());

  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  if (proto === "https") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
}

function applyRateHeaders(res: NextResponse, rate: RateLimitState): void {
  const resetSeconds = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
  const resetUnix = Math.floor(rate.resetAt / 1000);

  res.headers.set("X-RateLimit-Policy", rate.policy.name);
  res.headers.set("X-RateLimit-Limit", String(rate.policy.max));
  res.headers.set("X-RateLimit-Remaining", String(rate.remaining));
  res.headers.set("X-RateLimit-Reset", String(resetUnix));

  res.headers.set("RateLimit-Limit", String(rate.policy.max));
  res.headers.set("RateLimit-Remaining", String(rate.remaining));
  res.headers.set("RateLimit-Reset", String(resetSeconds));

  if (rate.limited) {
    res.headers.set("Retry-After", String(resetSeconds));
  }
}

function buildRateLimitedResponse(rate: RateLimitState): NextResponse {
  const resetSeconds = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    {
      ok: false,
      error: "Rate limit exceeded",
      policy: rate.policy.name,
      retryAfterSeconds: resetSeconds,
    },
    { status: 429 }
  );
}

export function middleware(req: NextRequest) {
  const policy = selectRateLimitPolicy(req);

  if (policy) {
    const rate = evaluateRateLimit(req, policy);
    if (rate.limited) {
      const limited = buildRateLimitedResponse(rate);
      applyRateHeaders(limited, rate);
      applySecurityHeaders(req, limited);
      return limited;
    }

    const res = NextResponse.next();
    applyRateHeaders(res, rate);
    applySecurityHeaders(req, res);
    return res;
  }

  const res = NextResponse.next();
  applySecurityHeaders(req, res);
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};

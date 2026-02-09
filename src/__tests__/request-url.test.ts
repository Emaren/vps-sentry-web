import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["NEXT_PUBLIC_APP_URL", "APP_URL", "NEXTAUTH_URL"] as const;
const ENV_SNAPSHOT = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

async function loadRequestUrl() {
  return import("../lib/request-url");
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ENV_SNAPSHOT.get(key);
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
  vi.resetModules();
});

describe("safeRequestUrl", () => {
  it("accepts absolute Request-like URL strings", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fallback.example";
    const { safeRequestUrl } = await loadRequestUrl();
    const out = safeRequestUrl({ url: "https://app.example/api/status?x=1" });
    expect(out.toString()).toBe("https://app.example/api/status?x=1");
  });

  it("uses nextUrl.href when req.url is invalid", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fallback.example";
    const { safeRequestUrl } = await loadRequestUrl();
    const out = safeRequestUrl({
      url: "[object Object]",
      nextUrl: { href: "https://next.example/api/hosts" },
    });
    expect(out.toString()).toBe("https://next.example/api/hosts");
  });

  it("builds from nextUrl pathname + search when href is missing", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fallback.example";
    const { safeRequestUrl } = await loadRequestUrl();
    const out = safeRequestUrl({
      url: "",
      nextUrl: { pathname: "/api/hosts", search: "?page=2" },
    });
    expect(out.toString()).toBe("https://fallback.example/api/hosts?page=2");
  });

  it("falls back to root path when all request URL fields are unusable", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fallback.example";
    const { safeRequestUrlString, safeRequestOrigin } = await loadRequestUrl();
    const out = safeRequestUrlString({ url: "[object Object]", nextUrl: {} });
    expect(out).toBe("https://fallback.example/");
    expect(safeRequestOrigin({ url: "[object Object]" })).toBe("https://fallback.example");
  });

  it("normalizes host-only fallback base values", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.APP_URL = "vps-sentry.tokentap.ca";
    delete process.env.NEXTAUTH_URL;
    const { safeRequestUrlString } = await loadRequestUrl();
    const out = safeRequestUrlString("/api/readyz");
    expect(out).toBe("https://vps-sentry.tokentap.ca/api/readyz");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unmock("@/lib/prisma");
});

describe("GET /api/readyz", () => {
  it("returns a basic readiness payload without DB probe by default", async () => {
    const { GET } = await import("@/app/api/readyz/route");
    const response = await GET(new Request("http://localhost:3036/api/readyz"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("vps-sentry-web");
    expect(body.checks.db).toBeNull();
  });

  it("runs a DB probe when check=db is requested", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ ok: 1 }]);
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        $queryRawUnsafe: queryRaw,
      },
    }));

    const { GET } = await import("@/app/api/readyz/route");
    const response = await GET(new Request("http://localhost:3036/api/readyz?check=db"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks.db.ok).toBe(true);
    expect(queryRaw).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns 503 when DB probe fails", async () => {
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        $queryRawUnsafe: vi.fn().mockRejectedValue(new Error("db_down")),
      },
    }));

    const { GET } = await import("@/app/api/readyz/route");
    const response = await GET(new Request("http://localhost:3036/api/readyz?db=1"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks.db.ok).toBe(false);
    expect(String(body.checks.db.error)).toContain("db_down");
  });
});

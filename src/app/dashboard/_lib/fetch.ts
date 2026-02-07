// /var/www/vps-sentry-web/src/app/dashboard/_lib/fetch.ts
import { prisma } from "@/lib/prisma";
import { getBaseUrlFromHeaders } from "@/lib/server-base-url";
import {
  normalizeStatusEnvelope,
  type Status,
  type StatusEnvelope,
} from "@/lib/status";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function getStatusEnvelopeSafe() {
  const base = await getBaseUrlFromHeaders();

  try {
    const res = await fetch(`${base}/api/status`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    const ts = new Date().toISOString();

    // Try to parse JSON even on non-200 so we can render something.
    const data = (await res.json().catch(() => null)) as unknown;

    if (!res.ok || !data || typeof data !== "object") {
      return normalizeStatusEnvelope({
        ok: false,
        ts,
        status: {
          host: "—",
          version: "—",
          ts,
          alerts_count: 1,
          alerts: [
            {
              title: "Status unavailable",
              detail: `GET /api/status -> ${res.status}`,
            },
          ],
          public_ports_count: 0,
          ports_public: [],
        },
        diff: null,
        warnings: [`dashboard_fallback: /api/status returned ${res.status}`],
      });
    }

    return normalizeStatusEnvelope(data as Status | StatusEnvelope);
  } catch (e: unknown) {
    const ts = new Date().toISOString();
    const detail = errorMessage(e);
    return normalizeStatusEnvelope({
      ok: false,
      ts,
      status: {
        host: "—",
        version: "—",
        ts,
        alerts_count: 1,
        alerts: [{ title: "Status fetch failed", detail }],
        public_ports_count: 0,
        ports_public: [],
      },
      diff: null,
      warnings: [`dashboard_fallback: ${detail}`],
    });
  }
}

export async function getUserBilling(email?: string | null) {
  if (!email) return null;
  try {
    const u = await prisma.user.findUnique({
      where: { email },
      select: {
        plan: true,
        hostLimit: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        subscriptionId: true,
        currentPeriodEnd: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return u;
  } catch {
    return null;
  }
}

// /var/www/vps-sentry-web/src/app/dashboard/_lib/fetch.ts
import { prisma } from "@/lib/prisma";
import { getBaseUrlFromHeaders } from "@/lib/server-base-url";
import {
  normalizeStatusEnvelope,
  type Status,
  type StatusEnvelope,
} from "@/lib/status";

export async function getStatusEnvelopeSafe() {
  const base = await getBaseUrlFromHeaders();

  try {
    const res = await fetch(`${base}/api/status`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    const ts = new Date().toISOString();

    // Try to parse JSON even on non-200 so we can render something.
    const data = (await res.json().catch(() => null)) as any;

    if (!res.ok || !data) {
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
      } as any);
    }

    return normalizeStatusEnvelope(data as Status | StatusEnvelope);
  } catch (e: any) {
    const ts = new Date().toISOString();
    return normalizeStatusEnvelope({
      ok: false,
      ts,
      status: {
        host: "—",
        version: "—",
        ts,
        alerts_count: 1,
        alerts: [{ title: "Status fetch failed", detail: String(e?.message ?? e) }],
        public_ports_count: 0,
        ports_public: [],
      },
      diff: null,
      warnings: [`dashboard_fallback: ${String(e?.message ?? e)}`],
    } as any);
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
      } as any,
    });
    return u as any;
  } catch {
    return null;
  }
}

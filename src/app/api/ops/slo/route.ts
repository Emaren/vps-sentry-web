import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";
import { safeRequestUrl } from "@/lib/request-url";
import { requireOpsAccess } from "@/lib/rbac";
import { buildSloSnapshot, formatSloSummary } from "@/lib/slo";

export const dynamic = "force-dynamic";

function hasValidSloToken(req: Request): boolean {
  const expected = process.env.VPS_SLO_TOKEN?.trim();
  if (!expected) return false;

  const provided = req.headers.get("x-slo-token")?.trim();
  if (!provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function isLoopbackProbeAllowed(): boolean {
  const raw = String(process.env.VPS_SLO_ALLOW_LOOPBACK_PROBE ?? "1")
    .trim()
    .toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

function normalizeHost(value: string | null): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[::1]")) return "::1";
  return raw.split(":")[0] ?? "";
}

function isLoopbackValue(value: string | null): boolean {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return false;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first === "127.0.0.1" || first === "::1" || first === "localhost";
}

function isTrustedLoopbackProbe(req: Request): boolean {
  if (!isLoopbackProbeAllowed()) return false;

  const host = normalizeHost(req.headers.get("host")) || normalizeHost(req.headers.get("x-forwarded-host"));
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    return false;
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const cfIp = req.headers.get("cf-connecting-ip");

  if (forwardedFor && !isLoopbackValue(forwardedFor)) return false;
  if (realIp && !isLoopbackValue(realIp)) return false;
  if (cfIp && !isLoopbackValue(cfIp)) return false;

  return true;
}

function parseWindowHours(req: Request): number | undefined {
  const url = safeRequestUrl(req);
  const raw = url.searchParams.get("windowHours");
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const value = Math.trunc(n);
  if (value < 1) return 1;
  if (value > 24 * 30) return 24 * 30;
  return value;
}

export async function GET(req: Request) {
  return runObservedRoute(req, { route: "/api/ops/slo", source: "ops-slo" }, async (obsCtx) => {
    let actorUserId: string | null = null;
    let authMode: "token" | "ops" | "loopback" = "token";

    if (!hasValidSloToken(req)) {
      if (isTrustedLoopbackProbe(req)) {
        authMode = "loopback";
      } else {
        const access = await requireOpsAccess();
        if (!access.ok) {
          incrementCounter("ops.slo.denied.total", 1, {
            status: access.status,
          });
          await writeAuditLog({
            req,
            action: "ops.slo.denied",
            detail: `status=${access.status} email=${access.email ?? "unknown"}`,
            meta: {
              route: "/api/ops/slo",
              status: access.status,
              requiredRole: "ops",
              email: access.email ?? null,
              role: access.role ?? null,
            },
          });
          return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
        }
        actorUserId = access.identity.userId;
        obsCtx.userId = actorUserId;
        authMode = "ops";
      }
    }

    const snapshot = await buildSloSnapshot({
      windowHours: parseWindowHours(req),
    });
    const summary = formatSloSummary(snapshot);

    incrementCounter("ops.slo.view.total", 1, {
      authMode,
      severity: snapshot.burn.severity,
      route: snapshot.burn.route,
      shouldAlert: snapshot.burn.shouldAlert ? "true" : "false",
    });

    await writeAuditLog({
      req,
      userId: actorUserId,
      action: "ops.slo.view",
      detail: summary,
      meta: {
        route: "/api/ops/slo",
        authMode,
        severity: snapshot.burn.severity,
        shouldAlert: snapshot.burn.shouldAlert,
        alertRoute: snapshot.burn.route,
        affectedObjectives: snapshot.burn.affectedObjectives,
        reason: snapshot.burn.reason,
      },
    });

    return NextResponse.json({
      ok: true,
      authMode,
      summary,
      snapshot,
    });
  });
}

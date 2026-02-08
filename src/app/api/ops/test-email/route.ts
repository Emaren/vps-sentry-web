// /var/www/vps-sentry-web/src/app/api/ops/test-email/route.ts
import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { sendEmailNotification } from "@/lib/notify/email";
import { buildOpsTestEmailBodies } from "@/lib/notify/templates";
import { incrementCounter, logEvent, runObservedRoute } from "@/lib/observability";

function envTrim(key: string): string | null {
  const v = process.env[key]?.trim();
  return v && v.length ? v : null;
}

function getBaseUrl(req: Request) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (!host) return null;
  return `${proto}://${host}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: Request) {
  return runObservedRoute(req, { route: "/api/ops/test-email", source: "ops-test-email" }, async (obsCtx) => {
    const access = await requireOpsAccess();
    if (!access.ok) {
      incrementCounter("ops.test_email.denied.total", 1, {
        status: access.status,
      });
      await writeAuditLog({
        req,
        action: "ops.test_email.denied",
        detail: `status=${access.status} email=${access.email ?? "unknown"}`,
        meta: {
          route: "/api/ops/test-email",
          status: access.status,
          requiredRole: "ops",
          email: access.email ?? null,
          role: access.role ?? null,
        },
      });
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    obsCtx.userId = access.identity.userId;

    try {
      const to = access.identity.email?.trim();
      if (!to) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.test_email.request",
        detail: `Test email requested by ${to}`,
        meta: {
          route: "/api/ops/test-email",
        },
      });

      const nowIso = new Date().toISOString();
      const { text, html } = buildOpsTestEmailBodies({
        host: envTrim("HOSTNAME") ?? "unknown",
        nowIso,
        baseUrl: getBaseUrl(req),
      });

      const sent = await sendEmailNotification({
        to,
        subject: "VPS Sentry — Test Email",
        text,
        html,
        metadata: {
          correlationId: obsCtx.correlationId,
          traceId: obsCtx.traceId,
          route: obsCtx.route,
          method: obsCtx.method,
        },
      });

      if (!sent.ok) {
        incrementCounter("ops.test_email.failed.total", 1);
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: "ops.test_email.failed",
          detail: sent.error,
          meta: {
            route: "/api/ops/test-email",
            code: sent.code ?? null,
            providerDetail: sent.detail ?? null,
          },
        });
        return NextResponse.json(
          { error: sent.error, detail: sent.detail, code: sent.code },
          { status: 502 }
        );
      }

      incrementCounter("ops.test_email.sent.total", 1);
      logEvent("info", "ops.test_email.sent", obsCtx, { to });
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.test_email.sent",
        detail: `Test email sent to ${to}`,
        meta: {
          to,
        },
      });

      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const message = errorMessage(e);
      incrementCounter("ops.test_email.error.total", 1);
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.test_email.failed",
        detail: message,
        meta: {
          route: "/api/ops/test-email",
        },
      });
      logEvent("error", "ops.test_email.failed", obsCtx, { error: message });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

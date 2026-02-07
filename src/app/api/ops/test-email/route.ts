// /var/www/vps-sentry-web/src/app/api/ops/test-email/route.ts
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { requireAdminAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";

function envTrim(key: string): string | null {
  const v = process.env[key]?.trim();
  return v && v.length ? v : null;
}

function requireEnv(key: string): string {
  const v = envTrim(key);
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: Request) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "ops.test_email.denied",
      detail: `status=${access.status} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/ops/test-email",
        status: access.status,
        email: access.email ?? null,
      },
    });
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

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

    const host = requireEnv("EMAIL_SERVER_HOST");
    const port = Number(requireEnv("EMAIL_SERVER_PORT"));
    const user = requireEnv("EMAIL_SERVER_USER");
    const pass = requireEnv("EMAIL_SERVER_PASSWORD");
    const from = requireEnv("EMAIL_FROM");

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to,
      subject: "VPS Sentry — Test Email",
      text:
        "✅ This is a test email from VPS Sentry.\n\n" +
        `Time: ${new Date().toLocaleString()}\n` +
        `Host: ${envTrim("HOSTNAME") ?? "unknown"}\n`,
    });

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
    await writeAuditLog({
      req,
      userId: access.identity.userId,
      action: "ops.test_email.failed",
      detail: message,
      meta: {
        route: "/api/ops/test-email",
      },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// /var/www/vps-sentry-web/src/app/api/ops/report-now/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { requireAdminAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import {
  buildReportEmailHtml,
  buildReportEmailSubject,
  buildReportEmailText,
  type ReportStatusJson,
} from "@/lib/notify/templates";

export const dynamic = "force-dynamic";

const TRIGGER_PATH = "/tmp/vps-sentry-report-now.json";
const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";

// Keep API snappy (avoid nginx 504)
const POLL_MAX_MS = 6_000;
const POLL_STEP_MS = 400;

// SMTP guardrails (avoid hanging requests)
const SMTP_TIMEOUT_MS = 12_000; // overall "give up" ceiling
const SMTP_CONNECTION_TIMEOUT_MS = 8_000;
const SMTP_GREETING_TIMEOUT_MS = 8_000;
const SMTP_SOCKET_TIMEOUT_MS = 10_000;

type SendEmailResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      detail?: string;
      code?: string;
    };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorCode(err: unknown): string | undefined {
  const candidate = err as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
}

async function readJsonSafe<T = unknown>(path: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(path, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

function getBaseUrl(req: Request) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (!host) return null;
  return `${proto}://${host}`;
}

function getMailFromEnv() {
  return (
    process.env.EMAIL_FROM ||
    process.env.AUTH_EMAIL_FROM ||
    process.env.NEXTAUTH_EMAIL_FROM ||
    ""
  );
}

type NormalizedSmtp = {
  host: string;
  port: number;
  secure: boolean; // true for 465 (implicit TLS)
  requireTLS?: boolean; // for 587 STARTTLS
  user: string;
  pass: string;
  from: string;
};

type SmtpConfig =
  | { kind: "ok"; cfg: NormalizedSmtp }
  | { kind: "missing"; error: string };

function parseSmtpUrl(urlStr: string): Omit<NormalizedSmtp, "from"> | null {
  try {
    const u = new URL(urlStr);

    const protocol = u.protocol.toLowerCase();
    if (protocol !== "smtp:" && protocol !== "smtps:") return null;

    const host = u.hostname;
    const port = u.port ? Number(u.port) : protocol === "smtps:" ? 465 : 587;

    // URL username/password can be percent-encoded; URL() gives decoded strings
    const user = u.username || "";
    const pass = u.password || "";

    const secure = protocol === "smtps:" || port === 465;
    const requireTLS = !secure && port === 587 ? true : undefined;

    if (!host || !port || !user || !pass) return null;

    return { host, port, secure, requireTLS, user, pass };
  } catch {
    return null;
  }
}

function getSmtpConfig(): SmtpConfig {
  const from = getMailFromEnv();

  if (!from) {
    return {
      kind: "missing",
      error:
        "Missing EMAIL_FROM (or AUTH_EMAIL_FROM / NEXTAUTH_EMAIL_FROM) in vps-sentry-web.service environment.",
    };
  }

  // 1) Prefer full connection URL if provided (recommended)
  const url =
    process.env.EMAIL_SERVER ||
    process.env.AUTH_EMAIL_SERVER ||
    process.env.NEXTAUTH_EMAIL_SERVER ||
    "";

  if (url) {
    const parsed = parseSmtpUrl(url);
    if (parsed) return { kind: "ok", cfg: { ...parsed, from } };

    return {
      kind: "missing",
      error:
        "EMAIL_SERVER is set but could not be parsed. Use smtp://user:pass@smtp.gmail.com:587 (or smtps://...:465). If your password has special characters, URL-encode it.",
    };
  }

  // 2) Otherwise support split env vars
  const host = process.env.EMAIL_SERVER_HOST || "";
  const portRaw = process.env.EMAIL_SERVER_PORT || "";
  const user = process.env.EMAIL_SERVER_USER || "";
  const pass = process.env.EMAIL_SERVER_PASSWORD || "";

  const port = Number(portRaw || "0");
  const secure = port === 465;
  const requireTLS = !secure && port === 587 ? true : undefined;

  if (host && port && user && pass) {
    return {
      kind: "ok",
      cfg: { host, port, secure, requireTLS, user, pass, from },
    };
  }

  return {
    kind: "missing",
    error:
      "Missing SMTP env. Provide either EMAIL_SERVER (recommended) OR all of: EMAIL_SERVER_HOST, EMAIL_SERVER_PORT, EMAIL_SERVER_USER, EMAIL_SERVER_PASSWORD.",
  };
}

async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }) {
  const cfgRes = getSmtpConfig();
  if (cfgRes.kind === "missing") {
    return { ok: false, error: cfgRes.error } as SendEmailResult;
  }
  const cfg = cfgRes.cfg;

  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = await import("nodemailer");
  } catch (e: unknown) {
    return {
      ok: false,
      error: "nodemailer is not available. Install it with: pnpm add nodemailer",
      detail: errorMessage(e),
    } as SendEmailResult;
  }

  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    requireTLS: cfg.requireTLS,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  });

  const timeoutPromise = new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error("SMTP send timeout")), SMTP_TIMEOUT_MS);
    if (typeof (t as NodeJS.Timeout).unref === "function") {
      (t as NodeJS.Timeout).unref();
    }
  });

  try {
    await Promise.race([
      transport.sendMail({
        from: cfg.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      }),
      timeoutPromise,
    ]);
    return { ok: true } as SendEmailResult;
  } catch (e: unknown) {
    const msg = errorMessage(e) || "Unknown email error";
    const code = errorCode(e);

    // normalize the UX-friendly label but keep detail for logs/JSON
    const label =
      msg.toLowerCase().includes("timeout") || code === "ETIMEDOUT"
        ? "Connection timeout"
        : "Email send failed";

    return {
      ok: false,
      error: label,
      detail: msg,
      code,
    } as SendEmailResult;
  } finally {
    try {
      transport.close?.();
    } catch {}
  }
}

export async function POST(req: Request) {
  const rid = crypto.randomUUID().slice(0, 8);

  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "ops.report_now.denied",
      detail: `status=${access.status} email=${access.email ?? "unknown"}`,
      meta: {
        rid,
        route: "/api/ops/report-now",
        status: access.status,
        email: access.email ?? null,
      },
    });
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const requestedBy = access.identity.email;
  const to = access.identity.email;

  await writeAuditLog({
    req,
    userId: access.identity.userId,
    action: "ops.report_now.request",
    detail: `Manual report requested by ${requestedBy}`,
    meta: {
      rid,
      route: "/api/ops/report-now",
    },
  });

  console.log(`[report-now:${rid}] start requestedBy=${requestedBy} to=${to ?? "—"}`);

  try {
    // Read status BEFORE (so we can detect that it changed)
    const before = await readJsonSafe<ReportStatusJson>(STATUS_PATH);
    const beforeTs = before?.ts ?? null;

    // Trigger: systemd path unit watches this
    await fs.writeFile(
      TRIGGER_PATH,
      JSON.stringify({ ts: new Date().toISOString(), requestedBy, reason: "manual-report" }, null, 2),
      "utf8"
    );

    await writeAuditLog({
      req,
      userId: access.identity.userId,
      action: "ops.report_now.trigger_written",
      detail: `Trigger file updated: ${TRIGGER_PATH}`,
      meta: {
        rid,
        triggerPath: TRIGGER_PATH,
      },
    });

    // Poll briefly for a newer status timestamp
    let after: ReportStatusJson | null = null;
    const start = Date.now();
    while (Date.now() - start < POLL_MAX_MS) {
      await sleep(POLL_STEP_MS);
      after = await readJsonSafe<ReportStatusJson>(STATUS_PATH);
      if (after?.ts && after.ts !== beforeTs) break;
    }

    const s = after?.ts && after.ts !== beforeTs ? after : after || before;

    console.log(`[report-now:${rid}] status ts=${s?.ts ?? "—"} (before=${beforeTs ?? "—"})`);

    if (!to) {
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.report_now.no_email",
        detail: "Admin has no email in session; skipping mail delivery",
        meta: {
          rid,
          statusTs: s?.ts ?? null,
        },
      });
      return NextResponse.json({
        ok: true,
        triggered: true,
        emailed: false,
        warning: "No session email found; cannot send report email.",
        statusTs: s?.ts ?? null,
      });
    }

    const baseUrl = getBaseUrl(req);
    const subject = buildReportEmailSubject(s);
    const text = buildReportEmailText({ requestedBy, baseUrl, s });
    const html = buildReportEmailHtml({ requestedBy, baseUrl, s });

    const mail = await sendEmail({ to, subject, text, html });

    if (!mail.ok) {
      console.log(
        `[report-now:${rid}] ERROR ${mail.error}${mail.detail ? ` — ${mail.detail}` : ""}`
      );
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.report_now.mail_failed",
        detail: `Mail delivery failed: ${mail.error}`,
        meta: {
          rid,
          error: mail.error,
          detail: mail.detail ?? null,
          code: mail.code ?? null,
          statusTs: s?.ts ?? null,
        },
      });

      return NextResponse.json(
        {
          ok: false,
          triggered: true,
          emailed: false,
          error: mail.error,
          detail: mail.detail,
          code: mail.code,
          statusTs: s?.ts ?? null,
        },
        { status: 502 }
      );
    }

    console.log(`[report-now:${rid}] emailed ok to=${to}`);
    await writeAuditLog({
      req,
      userId: access.identity.userId,
      action: "ops.report_now.mail_sent",
      detail: `Manual report emailed to ${to}`,
      meta: {
        rid,
        to,
        subject,
        statusTs: s?.ts ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      triggered: true,
      emailed: true,
      to,
      subject,
      statusTs: s?.ts ?? null,
    });
  } catch (err: unknown) {
    const message = errorMessage(err);
    await writeAuditLog({
      req,
      userId: access.identity.userId,
      action: "ops.report_now.failed",
      detail: message,
      meta: {
        rid,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Report trigger failed",
        detail: message,
      },
      { status: 500 }
    );
  }
}

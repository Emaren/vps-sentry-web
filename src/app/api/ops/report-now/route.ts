// /var/www/vps-sentry-web/src/app/api/ops/report-now/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";

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

type StatusJson = {
  ts?: string;
  host?: string;
  version?: string;
  baseline_last_accepted_ts?: string;
  alerts_count?: number;
  public_ports_count?: number;
  auth?: { ssh_failed_password?: number; ssh_invalid_user?: number };
  alerts?: Array<{ title?: string; detail?: string }>;
  ports_public?: Array<{ proto?: string; host?: string; port?: number; proc?: string; pid?: number }>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readJsonSafe<T = any>(path: string): Promise<T | null> {
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
    return { ok: false as const, error: cfgRes.error };
  }
  const cfg = cfgRes.cfg;

  let nodemailer: any;
  try {
    nodemailer = await import("nodemailer");
  } catch (e: any) {
    return {
      ok: false as const,
      error: "nodemailer is not available. Install it with: pnpm add nodemailer",
      detail: String(e?.message ?? e ?? ""),
    };
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
    const t: any = setTimeout(() => reject(new Error("SMTP send timeout")), SMTP_TIMEOUT_MS);
    t?.unref?.();
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
    return { ok: true as const };
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "Unknown email error");
    const code = e?.code ? String(e.code) : undefined;

    // normalize the UX-friendly label but keep detail for logs/JSON
    const label =
      msg.toLowerCase().includes("timeout") || code === "ETIMEDOUT"
        ? "Connection timeout"
        : "Email send failed";

    return {
      ok: false as const,
      error: label,
      detail: msg,
      code,
    };
  } finally {
    try {
      transport.close?.();
    } catch {}
  }
}

function buildEmailText(params: { requestedBy: string; baseUrl: string | null; s: StatusJson | null }) {
  const s = params.s;

  const host = s?.host ?? "—";
  const ts = s?.ts ?? "—";
  const ver = s?.version ?? "—";
  const baseline = s?.baseline_last_accepted_ts ?? "—";

  const alerts = typeof s?.alerts_count === "number" ? s.alerts_count : 0;
  const ports = typeof s?.public_ports_count === "number" ? s.public_ports_count : 0;
  const sshFailed = s?.auth?.ssh_failed_password ?? 0;
  const invalidUser = s?.auth?.ssh_invalid_user ?? 0;

  const lines: string[] = [];
  lines.push(`VPS Sentry report (manual trigger)`);
  lines.push(`Requested by: ${params.requestedBy}`);
  lines.push(``);
  lines.push(`Host: ${host}`);
  lines.push(`Version: ${ver}`);
  lines.push(`Snapshot ts: ${ts}`);
  lines.push(`Baseline accepted: ${baseline}`);
  lines.push(``);
  lines.push(`Summary:`);
  lines.push(`- Alerts: ${alerts}`);
  lines.push(`- Public ports: ${ports}`);
  lines.push(`- SSH failed: ${sshFailed}`);
  lines.push(`- Invalid user: ${invalidUser}`);

  if (Array.isArray(s?.alerts) && s.alerts.length > 0) {
    lines.push(``);
    lines.push(`Alerts:`);
    for (let i = 0; i < Math.min(10, s.alerts.length); i++) {
      const a = s.alerts[i];
      const title = a?.title ?? `Alert ${i + 1}`;
      lines.push(`${i + 1}) ${title}`);
      const d = (a?.detail ?? "").trim();
      if (d) lines.push(d.split("\n").slice(0, 6).join("\n"));
      lines.push(``);
    }
  }

  if (Array.isArray(s?.ports_public) && s.ports_public.length > 0) {
    lines.push(`Public listeners:`);
    for (let i = 0; i < Math.min(20, s.ports_public.length); i++) {
      const p = s.ports_public[i];
      lines.push(
        `- ${p?.proto ?? "tcp"} ${p?.host ?? "*"}:${p?.port ?? "?"} (${p?.proc ?? "?"} pid=${p?.pid ?? "?"})`
      );
    }
    lines.push(``);
  }

  if (params.baseUrl) {
    lines.push(`Dashboard: ${params.baseUrl}/dashboard`);
    lines.push(`Status API: ${params.baseUrl}/api/status`);
  }

  return lines.join("\n");
}

export async function POST(req: Request) {
  const rid = crypto.randomUUID().slice(0, 8);

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requestedBy = session.user?.email ?? session.user?.name ?? "user";
  const to = session.user?.email;

  console.log(`[report-now:${rid}] start requestedBy=${requestedBy} to=${to ?? "—"}`);

  // Read status BEFORE (so we can detect that it changed)
  const before = await readJsonSafe<StatusJson>(STATUS_PATH);
  const beforeTs = before?.ts ?? null;

  // Trigger: systemd path unit watches this
  await fs.writeFile(
    TRIGGER_PATH,
    JSON.stringify({ ts: new Date().toISOString(), requestedBy, reason: "manual-report" }, null, 2),
    "utf8"
  );

  // Poll briefly for a newer status timestamp
  let after: StatusJson | null = null;
  const start = Date.now();
  while (Date.now() - start < POLL_MAX_MS) {
    await sleep(POLL_STEP_MS);
    after = await readJsonSafe<StatusJson>(STATUS_PATH);
    if (after?.ts && after.ts !== beforeTs) break;
  }

  const s = after?.ts && after.ts !== beforeTs ? after : after || before;

  console.log(`[report-now:${rid}] status ts=${s?.ts ?? "—"} (before=${beforeTs ?? "—"})`);

  if (!to) {
    return NextResponse.json({
      ok: true,
      triggered: true,
      emailed: false,
      warning: "No session email found; cannot send report email.",
      statusTs: s?.ts ?? null,
    });
  }

  const host = s?.host ?? "VPS";
  const alerts = typeof s?.alerts_count === "number" ? s.alerts_count : 0;
  const ports = typeof s?.public_ports_count === "number" ? s.public_ports_count : 0;

  const headline = alerts > 0 ? "ACTION NEEDED" : ports > 0 ? "REVIEW" : "OK";
  const subject = `[VPS Sentry] ${headline} — ${host} (${alerts} alerts, ${ports} ports)`;

  const baseUrl = getBaseUrl(req);
  const text = buildEmailText({ requestedBy, baseUrl, s });

  const mail = await sendEmail({ to, subject, text });

  if (!mail.ok) {
    console.log(
      `[report-now:${rid}] ERROR ${mail.error}${(mail as any).detail ? ` — ${(mail as any).detail}` : ""}`
    );

    return NextResponse.json(
      {
        ok: false,
        triggered: true,
        emailed: false,
        error: mail.error,
        detail: (mail as any).detail,
        code: (mail as any).code,
        statusTs: s?.ts ?? null,
      },
      { status: 502 }
    );
  }

  console.log(`[report-now:${rid}] emailed ok to=${to}`);

  return NextResponse.json({
    ok: true,
    triggered: true,
    emailed: true,
    to,
    subject,
    statusTs: s?.ts ?? null,
  });
}

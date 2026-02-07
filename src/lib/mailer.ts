// /var/www/vps-sentry-web/src/lib/mailer.ts

import type SMTPTransport from "nodemailer/lib/smtp-transport";

/**
 * VPS Sentry mailer (server-only)
 *
 * Supports either:
 *  1) EMAIL_SERVER (recommended): smtp://user:pass@smtp.gmail.com:587  OR  smtps://user:pass@smtp.gmail.com:465
 *     - If your password contains special chars, URL-encode it.
 *
 *  2) Split vars:
 *     EMAIL_SERVER_HOST, EMAIL_SERVER_PORT, EMAIL_SERVER_USER, EMAIL_SERVER_PASSWORD
 *
 * Sender:
 *  EMAIL_FROM (or AUTH_EMAIL_FROM / NEXTAUTH_EMAIL_FROM)
 *
 * Also supports NextAuth-style aliases:
 *  AUTH_EMAIL_SERVER / NEXTAUTH_EMAIL_SERVER
 *  AUTH_EMAIL_FROM   / NEXTAUTH_EMAIL_FROM
 */

type NodemailerModule = typeof import("nodemailer");

export type NormalizedSmtp = {
  host: string;
  port: number;
  secure: boolean; // true for 465 (implicit TLS)
  requireTLS?: boolean; // for 587 STARTTLS
  user: string;
  pass: string;
  from: string;
};

export type SmtpConfig =
  | { kind: "ok"; cfg: NormalizedSmtp }
  | { kind: "missing"; error: string };

export type SendEmailHeaders = Record<string, string>;

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;

  /** Optional extras */
  replyTo?: string;
  headers?: SendEmailHeaders;
  cc?: string;
  bcc?: string;
};

export type SendEmailResult =
  | {
      ok: true;
      messageId?: string;
      accepted?: string[];
      rejected?: string[];
      response?: string;
    }
  | { ok: false; error: string; detail?: string; code?: string };

export type MailerTimeouts = {
  /** Overall "give up" ceiling */
  sendTimeoutMs: number;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
};

export const DEFAULT_MAILER_TIMEOUTS: MailerTimeouts = {
  sendTimeoutMs: 12_000,
  connectionTimeoutMs: 8_000,
  greetingTimeoutMs: 8_000,
  socketTimeoutMs: 10_000,
};

let _nodemailerPromise: Promise<NodemailerModule> | null = null;

async function getNodemailer(): Promise<NodemailerModule> {
  if (!_nodemailerPromise) _nodemailerPromise = import("nodemailer");
  return _nodemailerPromise;
}

function toErrMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function toErrCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as Record<string, unknown>).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

function getMailFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.EMAIL_FROM || env.AUTH_EMAIL_FROM || env.NEXTAUTH_EMAIL_FROM || "").trim();
}

function parseSmtpUrl(urlStr: string): Omit<NormalizedSmtp, "from"> | null {
  try {
    const u = new URL(urlStr);

    const protocol = u.protocol.toLowerCase();
    if (protocol !== "smtp:" && protocol !== "smtps:") return null;

    const host = u.hostname;
    const port = u.port ? Number(u.port) : protocol === "smtps:" ? 465 : 587;

    // URL username/password can be percent-encoded; URL() returns decoded strings
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

export function getSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const from = getMailFromEnv(env);

  if (!from) {
    return {
      kind: "missing",
      error:
        "Missing EMAIL_FROM (or AUTH_EMAIL_FROM / NEXTAUTH_EMAIL_FROM) in vps-sentry-web.service environment.",
    };
  }

  // 1) Prefer full connection URL if provided (recommended)
  const url = (env.EMAIL_SERVER || env.AUTH_EMAIL_SERVER || env.NEXTAUTH_EMAIL_SERVER || "").trim();
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
  const host = (env.EMAIL_SERVER_HOST || "").trim();
  const portRaw = (env.EMAIL_SERVER_PORT || "").trim();
  const user = (env.EMAIL_SERVER_USER || "").trim();
  const pass = (env.EMAIL_SERVER_PASSWORD || "").trim();

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

export function safeSmtpForLog(cfg: NormalizedSmtp) {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: cfg.requireTLS ?? false,
    user: cfg.user,
    from: cfg.from,
  };
}

function createTransportOptions(cfg: NormalizedSmtp, timeouts: MailerTimeouts): SMTPTransport.Options {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    requireTLS: cfg.requireTLS,
    connectionTimeout: timeouts.connectionTimeoutMs,
    greetingTimeout: timeouts.greetingTimeoutMs,
    socketTimeout: timeouts.socketTimeoutMs,
  };
}

type SentInfo = {
  messageId?: string;
  accepted?: unknown;
  rejected?: unknown;
  response?: string;
};

function toStringArray(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.map((v) => String(v));
}

export async function sendEmail(
  input: SendEmailInput,
  opts?: { env?: NodeJS.ProcessEnv; timeouts?: Partial<MailerTimeouts> }
): Promise<SendEmailResult> {
  const env = opts?.env ?? process.env;
  const timeouts: MailerTimeouts = { ...DEFAULT_MAILER_TIMEOUTS, ...(opts?.timeouts ?? {}) };

  const cfgRes = getSmtpConfig(env);
  if (cfgRes.kind === "missing") {
    return { ok: false, error: cfgRes.error };
  }
  const cfg = cfgRes.cfg;

  let nodemailer: NodemailerModule;
  try {
    nodemailer = await getNodemailer();
  } catch (e: unknown) {
    return {
      ok: false,
      error: "nodemailer is not available. Install it with: pnpm add nodemailer",
      detail: toErrMessage(e),
    };
  }

  const transport = nodemailer.createTransport(createTransportOptions(cfg, timeouts));

  const timeoutPromise = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new Error("SMTP send timeout")), timeouts.sendTimeoutMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t as any)?.unref?.();
  });

  try {
    const info = (await Promise.race([
      transport.sendMail({
        from: cfg.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,

        replyTo: input.replyTo,
        headers: input.headers,
        cc: input.cc,
        bcc: input.bcc,
      }),
      timeoutPromise,
    ])) as SentInfo;

    return {
      ok: true,
      messageId: info?.messageId,
      accepted: toStringArray(info?.accepted),
      rejected: toStringArray(info?.rejected),
      response: info?.response,
    };
  } catch (e: unknown) {
    const msg = toErrMessage(e);
    const code = toErrCode(e);

    const label =
      msg.toLowerCase().includes("timeout") || code === "ETIMEDOUT"
        ? "Connection timeout"
        : "Email send failed";

    return { ok: false, error: label, detail: msg, code };
  } finally {
    try {
      transport.close?.();
    } catch {
      // ignore
    }
  }
}

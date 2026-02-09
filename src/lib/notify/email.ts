import { incrementCounter, logEvent, observeTiming } from "@/lib/observability";
import { coerceUrlString } from "@/lib/safe-url";

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  metadata?: {
    correlationId?: string | null;
    traceId?: string | null;
    route?: string | null;
    method?: string | null;
  };
};

export type SendEmailResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      detail?: string;
      code?: string;
    };

type NormalizedSmtp = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  user: string;
  pass: string;
  from: string;
};

const SMTP_TIMEOUT_MS = 12_000;
const SMTP_CONNECTION_TIMEOUT_MS = 8_000;
const SMTP_GREETING_TIMEOUT_MS = 8_000;
const SMTP_SOCKET_TIMEOUT_MS = 10_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorCode(err: unknown): string | undefined {
  const candidate = err as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
}

function getMailFromEnv() {
  return (
    process.env.EMAIL_FROM ||
    process.env.AUTH_EMAIL_FROM ||
    process.env.NEXTAUTH_EMAIL_FROM ||
    ""
  );
}

function parseSmtpUrl(urlStr: string): Omit<NormalizedSmtp, "from"> | null {
  try {
    const u = new URL(coerceUrlString(urlStr));
    const protocol = u.protocol.toLowerCase();
    if (protocol !== "smtp:" && protocol !== "smtps:") return null;

    const host = u.hostname;
    const port = u.port ? Number(u.port) : protocol === "smtps:" ? 465 : 587;
    const user = u.username || "";
    const pass = u.password || "";

    if (!host || !port || !user || !pass) return null;

    const secure = protocol === "smtps:" || port === 465;
    const requireTLS = !secure && port === 587 ? true : undefined;
    return { host, port, secure, requireTLS, user, pass };
  } catch {
    return null;
  }
}

function getSmtpConfig():
  | { kind: "ok"; cfg: NormalizedSmtp }
  | { kind: "missing"; error: string } {
  const from = getMailFromEnv();
  if (!from) {
    return {
      kind: "missing",
      error:
        "Missing EMAIL_FROM (or AUTH_EMAIL_FROM / NEXTAUTH_EMAIL_FROM) in environment.",
    };
  }

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
        "EMAIL_SERVER is set but could not be parsed. Use smtp://user:pass@smtp.gmail.com:587 (or smtps://...:465).",
    };
  }

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
      "Missing SMTP env. Provide either EMAIL_SERVER or all split EMAIL_SERVER_* vars.",
  };
}

export async function sendEmailNotification(input: SendEmailInput): Promise<SendEmailResult> {
  const started = Date.now();
  const obsCtx = {
    correlationId: input.metadata?.correlationId ?? null,
    traceId: input.metadata?.traceId ?? null,
    spanId: null,
    route: input.metadata?.route ?? null,
    method: input.metadata?.method ?? null,
    userId: null,
    hostId: null,
  };
  incrementCounter("notify.email.send.attempt.total", 1);

  const smtp = getSmtpConfig();
  if (smtp.kind === "missing") {
    incrementCounter("notify.email.send.failure.total", 1, { reason: "smtp_missing" });
    observeTiming("notify.email.send.duration_ms", Date.now() - started, {
      ok: "false",
      reason: "smtp_missing",
    });
    logEvent("warn", "notify.email.smtp_missing", obsCtx, {
      error: smtp.error,
    });
    return { ok: false, error: smtp.error };
  }

  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = await import("nodemailer");
  } catch (err: unknown) {
    incrementCounter("notify.email.send.failure.total", 1, { reason: "nodemailer_missing" });
    observeTiming("notify.email.send.duration_ms", Date.now() - started, {
      ok: "false",
      reason: "nodemailer_missing",
    });
    logEvent("error", "notify.email.nodemailer_missing", obsCtx, {
      error: errorMessage(err),
    });
    return {
      ok: false,
      error: "nodemailer is not available",
      detail: errorMessage(err),
    };
  }

  const transport = nodemailer.createTransport({
    host: smtp.cfg.host,
    port: smtp.cfg.port,
    secure: smtp.cfg.secure,
    auth: { user: smtp.cfg.user, pass: smtp.cfg.pass },
    requireTLS: smtp.cfg.requireTLS,
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
        from: smtp.cfg.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
      timeoutPromise,
    ]);
    incrementCounter("notify.email.send.success.total", 1);
    observeTiming("notify.email.send.duration_ms", Date.now() - started, {
      ok: "true",
    });
    logEvent("info", "notify.email.sent", obsCtx, {
      to: input.to,
      subject: input.subject,
    });
    return { ok: true };
  } catch (err: unknown) {
    const msg = errorMessage(err);
    const code = errorCode(err);
    const reason =
      code === "ETIMEDOUT" || msg.toLowerCase().includes("timeout")
        ? "timeout"
        : "send_failed";
    incrementCounter("notify.email.send.failure.total", 1, { reason });
    observeTiming("notify.email.send.duration_ms", Date.now() - started, {
      ok: "false",
      reason,
    });
    logEvent("warn", "notify.email.failed", obsCtx, {
      to: input.to,
      code: code ?? null,
      reason,
      detail: msg,
    });
    return {
      ok: false,
      error: code === "ETIMEDOUT" || msg.toLowerCase().includes("timeout")
        ? "Connection timeout"
        : "Email send failed",
      detail: msg,
      code,
    };
  } finally {
    try {
      transport.close?.();
    } catch {}
  }
}

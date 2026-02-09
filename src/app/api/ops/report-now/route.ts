// /var/www/vps-sentry-web/src/app/api/ops/report-now/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";

export const runtime = "nodejs";
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

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

const FALLBACK_BASE =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost";

type ReportStatusJson = {
  ts?: string | null;
  [k: string]: unknown;
};

type SendEmailResult =
  | { ok: true }
  | { ok: false; error: string; detail?: string; code?: string };

// ---------- build-worker / weird Request hardening ----------

function isBadUrlString(v: unknown): boolean {
  if (typeof v !== "string") return true;
  const s = v.trim();
  if (!s) return true;
  if (s === "[object Object]") return true;
  return false;
}

function canParseUrlString(v: unknown): boolean {
  if (isBadUrlString(v)) return false;
  const s = String(v).trim();
  try {
    // eslint-disable-next-line no-new
    new URL(s, FALLBACK_BASE);
    return true;
  } catch {
    return false;
  }
}

function canParseNextUrl(nextUrl: unknown): boolean {
  if (!nextUrl || typeof nextUrl !== "object") return false;
  const anyNext = nextUrl as any;

  if (!isBadUrlString(anyNext?.href)) return canParseUrlString(anyNext.href);

  if (!isBadUrlString(anyNext?.pathname)) {
    const pathname = String(anyNext.pathname).trim();
    const search = typeof anyNext.search === "string" ? anyNext.search : "";
    return canParseUrlString(`${pathname}${search}`);
  }

  return false;
}

function shouldStub(req: Request): boolean {
  if (IS_BUILD_TIME) return true;

  const anyReq = req as any;
  const okUrl = canParseUrlString(anyReq?.url);

  const hasNextUrl = anyReq?.nextUrl !== undefined;
  const okNextUrl = !hasNextUrl ? true : canParseNextUrl(anyReq?.nextUrl);

  return !(okUrl && okNextUrl);
}

function safeUrlString(req: Request): string {
  const anyReq = req as any;

  const raw = anyReq?.url;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s && s !== "[object Object]") return s;
  }

  const href = anyReq?.nextUrl?.href;
  if (typeof href === "string") {
    const s = href.trim();
    if (s && s !== "[object Object]") return s;
  }

  return "/";
}

function toAbsoluteUrlString(u: string): string {
  const s = String(u ?? "/").trim() || "/";
  try {
    // absolute
    return new URL(s).toString();
  } catch {
    // relative -> base
    return new URL(s, FALLBACK_BASE).toString();
  }
}

/**
 * Minimal Request-like object with safe *absolute* string `url` and no `nextUrl`.
 * Use this when passing req into helpers that might do new URL(req.url).
 */
function makeSafeReq(req: Request): Request {
  const url = toAbsoluteUrlString(safeUrlString(req));
  const method = (req as any)?.method ?? "POST";
  return { headers: req.headers, url, method } as any as Request;
}

// ---------- stubs ----------

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    triggered: false,
    emailed: false,
    note: "stubbed during build collection",
  });
}

// ---------- misc helpers ----------

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
    if (typeof (t as NodeJS.Timeout).unref === "function") (t as NodeJS.Timeout).unref();
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

    const label =
      msg.toLowerCase().includes("timeout") || code === "ETIMEDOUT"
        ? "Connection timeout"
        : "Email send failed";

    return { ok: false, error: label, detail: msg, code } as SendEmailResult;
  } finally {
    try {
      transport.close?.();
    } catch {}
  }
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [rbacMod, auditMod, obsMod, tmplMod] = await Promise.all([
    import("@/lib/rbac"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/observability").catch(() => ({} as any)),
    import("@/lib/notify/templates").catch(() => ({} as any)),
  ]);

  const requireOpsAccess = (rbacMod as any).requireOpsAccess as () => Promise<any>;

  const writeAuditLog =
    (auditMod as any).writeAuditLog ??
    (async (_input: any) => {
      /* no-op */
    });

  const incrementCounter = (obsMod as any).incrementCounter ?? (() => {});
  const logEvent = (obsMod as any).logEvent ?? (() => {});
  const runObservedRoute =
    (obsMod as any).runObservedRoute ??
    (async (_req: Request, _meta: any, handler: (ctx: any) => Promise<Response>) => {
      return handler({
        correlationId: "fallback",
        traceId: "fallback",
        spanId: "fallback",
        parentSpanId: null,
        route: _meta?.route ?? null,
        method: (_req as any)?.method ?? null,
        userId: null,
        hostId: null,
        source: _meta?.source ?? null,
      });
    });

  // Templates are optional during hardening; provide safe fallbacks.
  const buildReportEmailSubject =
    (tmplMod as any).buildReportEmailSubject ?? ((_s: any) => "VPS Sentry report");
  const buildReportEmailText =
    (tmplMod as any).buildReportEmailText ??
    ((input: any) => `VPS Sentry report requested by ${input?.requestedBy ?? "unknown"}`);
  const buildReportEmailHtml =
    (tmplMod as any).buildReportEmailHtml ?? ((_input: any) => undefined);

  return {
    requireOpsAccess,
    writeAuditLog,
    incrementCounter,
    logEvent,
    runObservedRoute,
    buildReportEmailSubject,
    buildReportEmailText,
    buildReportEmailHtml,
  };
}

// ---------- route ----------

export async function POST(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubPost();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  return deps.runObservedRoute(
    safeReq,
    { route: "/api/ops/report-now", source: "ops-report-now" },
    async (obsCtx: any) => {
      const correlationId =
        typeof obsCtx?.correlationId === "string" ? obsCtx.correlationId : "fallback";
      const rid = correlationId.slice(0, 8);

      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.report_now.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.report_now.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            rid,
            route: "/api/ops/report-now",
            status: access?.status ?? 403,
            requiredRole: "ops",
            email: access?.email ?? null,
            role: access?.role ?? null,
          },
        });

        return NextResponse.json(
          { ok: false, error: access?.error ?? "Access denied" },
          { status: typeof access?.status === "number" ? access.status : 403 }
        );
      }

      obsCtx.userId = access.identity.userId;

      const requestedBy = access.identity.email;
      const to = access.identity.email;

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: "ops.report_now.request",
        detail: `Manual report requested by ${requestedBy}`,
        meta: { rid, route: "/api/ops/report-now" },
      });

      deps.logEvent?.("info", "ops.report_now.start", obsCtx, {
        requestedBy,
        to: to ?? null,
        rid,
      });

      try {
        // Read status BEFORE (so we can detect that it changed)
        const before = await readJsonSafe<ReportStatusJson>(STATUS_PATH);
        const beforeTs = (before?.ts as string | null | undefined) ?? null;

        // Trigger: systemd path unit watches this
        await fs.writeFile(
          TRIGGER_PATH,
          JSON.stringify(
            { ts: new Date().toISOString(), requestedBy, reason: "manual-report" },
            null,
            2
          ),
          "utf8"
        );

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          action: "ops.report_now.trigger_written",
          detail: `Trigger file updated: ${TRIGGER_PATH}`,
          meta: { rid, triggerPath: TRIGGER_PATH },
        });

        // Poll briefly for a newer status timestamp
        let after: ReportStatusJson | null = null;
        const start = Date.now();
        while (Date.now() - start < POLL_MAX_MS) {
          await sleep(POLL_STEP_MS);
          after = await readJsonSafe<ReportStatusJson>(STATUS_PATH);
          if (after?.ts && after.ts !== beforeTs) break;
        }

        const s =
          after?.ts && after.ts !== beforeTs ? after : after || before;

        deps.logEvent?.("info", "ops.report_now.status_loaded", obsCtx, {
          rid,
          beforeTs,
          statusTs: (s?.ts as string | null | undefined) ?? null,
        });

        if (!to) {
          deps.incrementCounter("ops.report_now.no_email.total", 1);
          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            action: "ops.report_now.no_email",
            detail: "Admin has no email in session; skipping mail delivery",
            meta: { rid, statusTs: (s?.ts as string | null | undefined) ?? null },
          });

          return NextResponse.json({
            ok: true,
            triggered: true,
            emailed: false,
            warning: "No session email found; cannot send report email.",
            statusTs: (s?.ts as string | null | undefined) ?? null,
          });
        }

        const baseUrl = getBaseUrl(safeReq);
        const subject = deps.buildReportEmailSubject(s);
        const text = deps.buildReportEmailText({ requestedBy, baseUrl, s });
        const html = deps.buildReportEmailHtml({ requestedBy, baseUrl, s });

        const mail = await sendEmail({ to, subject, text, html });

        if (!mail.ok) {
          deps.incrementCounter("ops.report_now.mail_failed.total", 1, {
            code: mail.code ?? "unknown",
          });

          deps.logEvent?.("warn", "ops.report_now.mail_failed", obsCtx, {
            rid,
            error: mail.error,
            detail: mail.detail ?? null,
            code: mail.code ?? null,
          });

          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            action: "ops.report_now.mail_failed",
            detail: `Mail delivery failed: ${mail.error}`,
            meta: {
              rid,
              error: mail.error,
              detail: mail.detail ?? null,
              code: mail.code ?? null,
              statusTs: (s?.ts as string | null | undefined) ?? null,
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
              statusTs: (s?.ts as string | null | undefined) ?? null,
            },
            { status: 502 }
          );
        }

        deps.incrementCounter("ops.report_now.mail_sent.total", 1);

        deps.logEvent?.("info", "ops.report_now.mail_sent", obsCtx, {
          rid,
          to,
          subject,
        });

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          action: "ops.report_now.mail_sent",
          detail: `Manual report emailed to ${to}`,
          meta: {
            rid,
            to,
            subject,
            statusTs: (s?.ts as string | null | undefined) ?? null,
          },
        });

        return NextResponse.json({
          ok: true,
          triggered: true,
          emailed: true,
          to,
          subject,
          statusTs: (s?.ts as string | null | undefined) ?? null,
        });
      } catch (err: unknown) {
        deps.incrementCounter("ops.report_now.errors.total", 1);

        const message = errorMessage(err);

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          action: "ops.report_now.failed",
          detail: message,
          meta: { rid },
        });

        deps.logEvent?.("error", "ops.report_now.failed", obsCtx, {
          rid,
          error: message,
        });

        return NextResponse.json(
          { ok: false, error: "Report trigger failed", detail: message },
          { status: 500 }
        );
      }
    }
  );
}

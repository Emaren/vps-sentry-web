// /var/www/vps-sentry-web/src/app/api/ops/test-email/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSmtpConfig, safeSmtpForLog, sendEmail } from "@/lib/mailer";
import os from "node:os";
import crypto from "node:crypto";

function envTrim(key: string): string | null {
  const v = process.env[key]?.trim();
  return v && v.length ? v : null;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toErrMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function json(data: unknown, init?: { status?: number }) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function inferBaseUrl(): string | null {
  const raw = envTrim("APP_URL") ?? envTrim("NEXTAUTH_URL") ?? envTrim("VERCEL_URL");
  if (!raw) return null;

  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  const lower = raw.toLowerCase();
  const isLocal =
    lower.includes("localhost") || lower.includes("127.0.0.1") || lower.includes("0.0.0.0");

  return `${isLocal ? "http" : "https"}://${raw}`;
}

function dashboardUrlFromBase(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  try {
    return new URL("/dashboard", baseUrl).toString();
  } catch {
    return null;
  }
}

function transportLabel(cfg: { secure: boolean; port: number; requireTLS?: boolean }): string {
  if (cfg.secure || cfg.port === 465) return "SMTPS (implicit TLS)";
  if (cfg.port === 587 || cfg.requireTLS) return "STARTTLS";
  return "SMTP";
}

export async function POST() {
  const runId = crypto.randomUUID().slice(0, 8);

  try {
    const session = await getServerSession(authOptions);
    const to = session?.user?.email?.trim();
    if (!to) return json({ ok: false, error: "Unauthorized", runId }, { status: 401 });

    const cfgRes = getSmtpConfig(process.env);
    if (cfgRes.kind !== "ok") {
      return json({ ok: false, error: cfgRes.error, runId }, { status: 500 });
    }

    const cfg = cfgRes.cfg;
    const safe = safeSmtpForLog(cfg);

    const nowIso = new Date().toISOString();
    const serverHost = envTrim("HOSTNAME") ?? os.hostname() ?? "unknown";
    const baseUrl = inferBaseUrl();
    const dashboardUrl = dashboardUrlFromBase(baseUrl);

    const proto = transportLabel(cfg);

    const subject = "✅ VPS Sentry — Test email (SMTP OK)";
    const preheader = "SMTP is configured correctly — next: open the dashboard and send a report.";

    const text =
      `VPS Sentry — Test Email\n` +
      `Run ID: ${runId}\n\n` +
      `If you're reading this, your SMTP settings are working.\n\n` +
      `Details\n` +
      `- Time (UTC): ${nowIso}\n` +
      `- Server: ${serverHost}\n` +
      `- From: ${safe.from}\n` +
      `- To: ${to}\n` +
      `- SMTP: ${safe.host}:${safe.port}\n` +
      `- Transport: ${proto}\n\n` +
      `Next steps\n` +
      `- Open the dashboard and click "Send report now".\n` +
      (dashboardUrl ? `- Dashboard: ${dashboardUrl}\n` : "") +
      `- If emails arrive slowly, check SPF/DKIM/DMARC and spam folder.\n`;

    const html = `
<!doctype html>
<html>
  <head>
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background:#f6f7f9;color:#0b1220;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(preheader)}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f6f7f9" style="background:#f6f7f9;">
      <tr>
        <td align="center" style="padding:22px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="760" style="max-width:760px;width:100%;">
            <tr>
              <td style="font-size:14px;color:#55607a;padding:0 2px;">VPS Sentry</td>
            </tr>

            <tr>
              <td style="padding-top:12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="width:40px;vertical-align:top;">
                      <div style="width:34px;height:34px;border-radius:10px;background:#22c55e;display:block;text-align:center;line-height:34px;color:#fff;font-weight:900;">✓</div>
                    </td>
                    <td style="vertical-align:top;padding-left:10px;">
                      <div style="font-size:30px;font-weight:900;letter-spacing:-0.02em;line-height:1.1;">Test email</div>
                      <div style="margin-top:6px;color:#334155;line-height:1.6;">
                        If you're reading this, your <b>SMTP settings are working</b>.
                      </div>
                      <div style="margin-top:6px;color:#64748b;font-size:12px;line-height:1.4;">
                        Run ID: <b>${escapeHtml(runId)}</b>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              dashboardUrl
                ? `
            <tr>
              <td style="padding-top:14px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="#0b1220" style="background:#0b1220;border-radius:12px;">
                      <a href="${escapeHtml(dashboardUrl)}"
                        style="display:inline-block;color:#ffffff;text-decoration:none;padding:12px 16px;border-radius:12px;font-weight:800;">
                        Open Dashboard
                      </a>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:8px;color:#64748b;font-size:12px;line-height:1.4;">
                  If the button doesn’t work, copy/paste this link:<br/>
                  <span style="word-break:break-all;">${escapeHtml(dashboardUrl)}</span>
                </div>
              </td>
            </tr>
            `
                : ""
            }

            <tr>
              <td style="padding-top:16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff"
                  style="background:#ffffff;border:1px solid rgba(15,23,42,0.10);border-radius:16px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font-weight:900;margin-bottom:8px;">Details</div>
                      <div style="line-height:1.7;color:#0f172a;">
                        <div><b>Time (UTC):</b> ${escapeHtml(nowIso)}</div>
                        <div><b>Server:</b> ${escapeHtml(serverHost)}</div>
                        <div><b>From:</b> ${escapeHtml(safe.from)}</div>
                        <div><b>To:</b> ${escapeHtml(to)}</div>
                        <div><b>SMTP:</b> ${escapeHtml(`${safe.host}:${safe.port}`)}</div>
                        <div><b>Transport:</b> ${escapeHtml(proto)}</div>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding-top:16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff"
                  style="background:#ffffff;border:1px solid rgba(15,23,42,0.10);border-radius:16px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font-weight:900;margin-bottom:8px;">Next steps</div>
                      <ol style="margin:0;padding-left:18px;line-height:1.6;color:#0f172a;">
                        <li>Open the dashboard and click <b>Send report now</b>.</li>
                        <li>If emails arrive slowly, check SPF/DKIM/DMARC and your spam folder.</li>
                      </ol>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding-top:14px;color:#64748b;font-size:12px;line-height:1.5;">
                You’re receiving this because you triggered a test email from VPS Sentry.
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    `.trim();

    const res = await sendEmail(
      {
        to,
        subject,
        text,
        html,
        replyTo: safe.from,
        headers: {
          "X-VPSSentry-RunId": runId,
          "X-VPSSentry-Server": serverHost,
          "X-VPSSentry-Transport": proto,
        },
      },
      { env: process.env }
    );

    if (!res.ok) {
      return json(
        { ok: false, error: res.error, detail: res.detail, code: res.code, runId },
        { status: 500 }
      );
    }

    return json({
      ok: true,
      runId,
      messageId: res.messageId,
      accepted: res.accepted,
      rejected: res.rejected,
      to,
      smtp: { host: safe.host, port: safe.port, transport: proto },
      server: serverHost,
      timeUtc: nowIso,
      dashboardUrl,
    });
  } catch (e: unknown) {
    return json({ ok: false, error: toErrMessage(e), runId }, { status: 500 });
  }
}

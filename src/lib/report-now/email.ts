// /var/www/vps-sentry-web/src/lib/report-now/email.ts

import type { StatusJson } from "./types";

type Severity = {
  headline: "ACTION NEEDED" | "REVIEW" | "OK";
  emoji: string;
  tone: "bad" | "warn" | "ok";
};

type BuildReportEmailParams = {
  rid: string;
  requestedBy: string;
  baseUrl: string | null;
  s: StatusJson | null;
  triggeredAtIso: string;
  beforeTs: string | null;
  pollMs: number;
  refreshed: boolean;
};

export type BuildReportEmailResult = {
  subject: string;
  text: string;
  html: string;
  severity: Severity;
};

function safeNum(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function isoOrDash(s?: string): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(s);
}

function escapeHtml(input: string): string {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function computeSeverity(params: {
  alerts: number;
  ports: number;
  sshFailed: number;
  invalidUser: number;
}): Severity {
  const { alerts, ports, sshFailed, invalidUser } = params;
  if (alerts > 0) return { headline: "ACTION NEEDED", emoji: "🚨", tone: "bad" };
  if (ports > 0 || sshFailed > 0 || invalidUser > 0) return { headline: "REVIEW", emoji: "⚠️", tone: "warn" };
  return { headline: "OK", emoji: "✅", tone: "ok" };
}

function toneColor(sev: Severity) {
  if (sev.tone === "bad") return { bg: "#fee2e2", fg: "#991b1b", border: "#fecaca" };
  if (sev.tone === "warn") return { bg: "#fef3c7", fg: "#92400e", border: "#fde68a" };
  return { bg: "#dcfce7", fg: "#166534", border: "#bbf7d0" };
}

function urlFromBase(baseUrl: string | null, path: string): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return null;
  }
}

function transportLabel(cfg: { secure?: boolean; port?: number; requireTLS?: boolean }): string {
  const secure = !!cfg.secure;
  const port = Number(cfg.port ?? 0);
  if (secure || port === 465) return "SMTPS (implicit TLS)";
  if (port === 587 || cfg.requireTLS) return "STARTTLS";
  return "SMTP";
}

function buttonHtml(opts: { href: string; label: string; variant: "primary" | "ghost" | "blue" }) {
  const common =
    "display:inline-block;text-decoration:none;font-weight:800;border-radius:12px;padding:12px 16px;";
  const style =
    opts.variant === "primary"
      ? `${common}background:#0b1220;color:#ffffff;`
      : opts.variant === "blue"
        ? `${common}background:#2563eb;color:#ffffff;`
        : `${common}background:#ffffff;color:#0b1220;border:1px solid #e2e8f0;`;

  // Outlook-safe button wrapper
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin-right:10px;">
    <tr>
      <td style="border-radius:12px;">
        <a href="${escapeHtml(opts.href)}" style="${style}">${escapeHtml(opts.label)}</a>
      </td>
    </tr>
  </table>
  `.trim();
}

export function buildReportEmail(p: BuildReportEmailParams): BuildReportEmailResult {
  const s = p.s;

  const host = (s?.host ?? "—").toString();
  const ver = (s?.version ?? "—").toString();
  const snapshotTs = isoOrDash(s?.ts);
  const baseline = isoOrDash(s?.baseline_last_accepted_ts);

  const alerts = safeNum(s?.alerts_count);
  const ports = safeNum(s?.public_ports_count);
  const sshFailed = safeNum(s?.auth?.ssh_failed_password);
  const invalidUser = safeNum(s?.auth?.ssh_invalid_user);

  const sev = computeSeverity({ alerts, ports, sshFailed, invalidUser });
  const tone = toneColor(sev);

  const dashboardUrl = urlFromBase(p.baseUrl, "/dashboard");
  const statusUrl = urlFromBase(p.baseUrl, "/api/status");
  const supportUrl = urlFromBase(p.baseUrl, "/api/support/bundle");

  const freshnessLine = p.refreshed
    ? `Freshness: NEW snapshot observed (within ~${Math.round(p.pollMs)}ms)`
    : `Freshness: Latest snapshot (no newer status within ${Math.round(p.pollMs)}ms)`;

  const subject = `[VPS Sentry] ${sev.emoji} ${sev.headline} — ${host} (${alerts} alerts, ${ports} ports, ${sshFailed} ssh fails, ${invalidUser} invalid users)`;

  // ---------------- TEXT ----------------
  const lines: string[] = [];
  lines.push(`VPS Sentry Report — Manual trigger`);
  lines.push(`${sev.emoji} Status: ${sev.headline}`);
  lines.push(`Run ID: ${p.rid}`);
  lines.push(`Requested by: ${p.requestedBy}`);
  lines.push(`Generated at: ${p.triggeredAtIso}`);
  lines.push(freshnessLine);
  lines.push(``);
  lines.push(`System`);
  lines.push(`- Host: ${host}`);
  lines.push(`- Agent version: ${ver}`);
  lines.push(`- Snapshot time (UTC): ${snapshotTs}`);
  lines.push(`- Baseline accepted (UTC): ${baseline}`);
  lines.push(``);
  lines.push(`What we found`);
  lines.push(`- Alerts: ${alerts}`);
  lines.push(`- Public ports: ${ports}`);
  lines.push(`- SSH failed password attempts: ${sshFailed}`);
  lines.push(`- SSH invalid user attempts: ${invalidUser}`);
  lines.push(``);

  if (dashboardUrl || statusUrl || supportUrl) {
    lines.push(`Quick links`);
    if (dashboardUrl) lines.push(`- Dashboard: ${dashboardUrl}`);
    if (statusUrl) lines.push(`- Status JSON: ${statusUrl}`);
    if (supportUrl) lines.push(`- Support bundle: ${supportUrl}`);
    lines.push(``);
  }

  lines.push(`Recommended next steps`);
  if (sev.headline === "ACTION NEEDED") {
    lines.push(`1) Open the Dashboard and review the Alerts section.`);
    lines.push(`2) If any alert indicates compromise, rotate credentials and patch immediately.`);
    lines.push(`3) Confirm all public ports are expected; close anything you don't recognize.`);
  } else if (sev.headline === "REVIEW") {
    lines.push(`1) Review public ports and recent SSH attempt counts for anything unexpected.`);
    lines.push(`2) If the ports/attempts are expected, you can ignore this report.`);
  } else {
    lines.push(`No action required.`);
  }
  lines.push(``);

  // Alerts
  if (Array.isArray(s?.alerts) && s.alerts.length > 0) {
    lines.push(`Alerts (top ${Math.min(10, s.alerts.length)} of ${s.alerts.length})`);
    for (let i = 0; i < Math.min(10, s.alerts.length); i++) {
      const a = s.alerts[i];
      lines.push(`${i + 1}) ${(a?.title ?? `Alert ${i + 1}`).trim()}`);
      const d = (a?.detail ?? "").trim();
      if (d) lines.push(d.split("\n").slice(0, 10).join("\n"));
      lines.push(``);
    }
  } else {
    lines.push(`Alerts: none`);
    lines.push(``);
  }

  // Ports
  if (Array.isArray(s?.ports_public) && s.ports_public.length > 0) {
    lines.push(`Public listeners (top ${Math.min(20, s.ports_public.length)} of ${s.ports_public.length})`);
    for (let i = 0; i < Math.min(20, s.ports_public.length); i++) {
      const pp = s.ports_public[i];
      lines.push(
        `- ${pp?.proto ?? "tcp"} ${pp?.host ?? "*"}:${pp?.port ?? "?"} (${pp?.proc ?? "?"} pid=${pp?.pid ?? "?"})`
      );
    }
    lines.push(``);
  } else {
    lines.push(`Public listeners: none`);
    lines.push(``);
  }

  lines.push(`Debug`);
  lines.push(`- status.ts: ${snapshotTs}`);
  lines.push(`- status.before.ts: ${p.beforeTs ?? "—"}`);
  lines.push(``);

  const text = lines.join("\n");

  // ---------------- HTML (LIGHT THEME ONLY) ----------------
  const preheader = `${sev.headline} · ${host} · ${alerts} alerts · ${ports} ports`;

  const alertCards = (() => {
    if (!Array.isArray(s?.alerts) || s.alerts.length === 0) {
      return `
        <div style="padding:12px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;">
          ✅ No alerts reported in this snapshot.
        </div>
      `.trim();
    }

    return s.alerts.slice(0, 10).map((a, idx) => {
      const title = escapeHtml((a?.title ?? `Alert ${idx + 1}`).trim());
      const detailRaw = (a?.detail ?? "").trim();
      const detail = escapeHtml(detailRaw.split("\n").slice(0, 10).join("\n"));

      return `
        <div style="margin-top:10px;padding:12px;border:1px solid #e2e8f0;border-left:6px solid ${tone.border};border-radius:12px;background:#ffffff;">
          <div style="font-weight:900;color:#0b1220;">${idx + 1}) ${title}</div>
          ${
            detail
              ? `<pre style="margin:10px 0 0;padding:10px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;white-space:pre-wrap;color:#0b1220;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.45;">${detail}</pre>`
              : ""
          }
        </div>
      `.trim();
    }).join("");
  })();

  const portsTable = (() => {
    if (!Array.isArray(s?.ports_public) || s.ports_public.length === 0) {
      return `
        <div style="padding:12px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;">
          ✅ No public listeners reported in this snapshot.
        </div>
      `.trim();
    }

    const rows = s.ports_public.slice(0, 20).map((pp) => {
      const proto = escapeHtml(pp?.proto ?? "tcp");
      const listener = escapeHtml(`${pp?.host ?? "*"}:${pp?.port ?? "?"}`);
      const proc = escapeHtml(pp?.proc ?? "?");
      const pid = escapeHtml(String(pp?.pid ?? "?"));
      return `
        <tr>
          <td style="padding:8px 10px;border-top:1px solid #e2e8f0;">${proto}</td>
          <td style="padding:8px 10px;border-top:1px solid #e2e8f0;">${listener}</td>
          <td style="padding:8px 10px;border-top:1px solid #e2e8f0;">${proc}</td>
          <td style="padding:8px 10px;border-top:1px solid #e2e8f0;">${pid}</td>
        </tr>
      `.trim();
    });

    return `
      <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#ffffff;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
          <thead>
            <tr style="background:#f8fafc;text-align:left;">
              <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Proto</th>
              <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Listener</th>
              <th style="padding:10px;border-bottom:1px solid #e2e8f0;">Process</th>
              <th style="padding:10px;border-bottom:1px solid #e2e8f0;">PID</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join("")}
          </tbody>
        </table>
      </div>
    `.trim();
  })();

  const buttons = [
    dashboardUrl ? buttonHtml({ href: dashboardUrl, label: "Open Dashboard", variant: "primary" }) : "",
    statusUrl ? buttonHtml({ href: statusUrl, label: "View Status JSON", variant: "ghost" }) : "",
    supportUrl ? buttonHtml({ href: supportUrl, label: "Support Bundle", variant: "blue" }) : "",
  ].filter(Boolean).join("\n");

  const fallbackLink = dashboardUrl
    ? `
    <div style="margin-top:10px;color:#64748b;font-size:12px;line-height:1.4;">
      If a button doesn’t work, copy/paste:<br/>
      <span style="word-break:break-all;">${escapeHtml(dashboardUrl)}</span>
    </div>
  `.trim()
    : "";

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>VPS Sentry Report</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7f9;color:#0b1220;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <!-- Preheader (hidden) -->
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
              <td style="padding-top:10px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="vertical-align:top;">
                      <div style="font-size:30px;font-weight:900;letter-spacing:-0.02em;line-height:1.1;color:#0b1220;">
                        ${escapeHtml(sev.emoji)} ${escapeHtml(sev.headline)} — ${escapeHtml(host)}
                      </div>
                      <div style="margin-top:6px;color:#475569;line-height:1.55;font-size:13px;">
                        Manual report triggered by <b>${escapeHtml(p.requestedBy)}</b><br/>
                        Run ID: <b>${escapeHtml(p.rid)}</b> · Generated: <b>${escapeHtml(p.triggeredAtIso)}</b>
                      </div>
                      <div style="margin-top:10px;color:#64748b;font-size:12px;line-height:1.4;">
                        ${escapeHtml(freshnessLine)}
                      </div>
                    </td>
                    <td align="right" style="vertical-align:top;padding-left:10px;">
                      <div style="display:inline-block;background:${tone.bg};color:${tone.fg};border:1px solid ${tone.border};padding:8px 12px;border-radius:999px;font-weight:900;font-size:12px;">
                        ${escapeHtml(sev.headline)}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              buttons
                ? `
            <tr>
              <td style="padding-top:14px;">
                ${buttons}
                ${fallbackLink}
              </td>
            </tr>
            `
                : ""
            }

            <!-- Summary card -->
            <tr>
              <td style="padding-top:16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff"
                  style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                        <tr>
                          <td width="25%" style="padding:10px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;">
                            <div style="font-size:12px;color:#64748b;">Alerts</div>
                            <div style="font-size:22px;font-weight:900;color:#0b1220;margin-top:4px;">${escapeHtml(String(alerts))}</div>
                          </td>
                          <td width="25%" style="padding:10px 0 0 10px;">
                            <div style="padding:10px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;">
                              <div style="font-size:12px;color:#64748b;">Public ports</div>
                              <div style="font-size:22px;font-weight:900;color:#0b1220;margin-top:4px;">${escapeHtml(String(ports))}</div>
                            </div>
                          </td>
                          <td width="25%" style="padding:10px 0 0 10px;">
                            <div style="padding:10px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;">
                              <div style="font-size:12px;color:#64748b;">SSH failed</div>
                              <div style="font-size:22px;font-weight:900;color:#0b1220;margin-top:4px;">${escapeHtml(String(sshFailed))}</div>
                            </div>
                          </td>
                          <td width="25%" style="padding:10px 0 0 10px;">
                            <div style="padding:10px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;">
                              <div style="font-size:12px;color:#64748b;">Invalid user</div>
                              <div style="font-size:22px;font-weight:900;color:#0b1220;margin-top:4px;">${escapeHtml(String(invalidUser))}</div>
                            </div>
                          </td>
                        </tr>
                      </table>

                      <div style="margin-top:14px;">
                        <div style="font-weight:900;margin-bottom:6px;color:#0b1220;">Recommended next steps</div>
                        ${
                          sev.headline === "ACTION NEEDED"
                            ? `<ol style="margin:0;padding-left:18px;line-height:1.55;color:#0b1220;">
                                 <li>Open the Dashboard and review the Alerts section.</li>
                                 <li>If any alert indicates compromise, rotate credentials and patch immediately.</li>
                                 <li>Confirm all public ports are expected; close anything you don't recognize.</li>
                               </ol>`
                            : sev.headline === "REVIEW"
                              ? `<ol style="margin:0;padding-left:18px;line-height:1.55;color:#0b1220;">
                                   <li>Review public ports and recent SSH attempt counts for anything unexpected.</li>
                                   <li>If ports/attempts are expected, you can ignore this report.</li>
                                 </ol>`
                              : `<div style="line-height:1.55;color:#0b1220;">No action required.</div>`
                        }
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Alerts -->
            <tr>
              <td style="padding-top:18px;">
                <div style="font-size:20px;font-weight:900;color:#0b1220;margin-bottom:10px;">Alerts</div>
                ${alertCards}
              </td>
            </tr>

            <!-- Ports -->
            <tr>
              <td style="padding-top:18px;">
                <div style="font-size:20px;font-weight:900;color:#0b1220;margin-bottom:10px;">Public listeners</div>
                ${portsTable}
              </td>
            </tr>

            <!-- System details -->
            <tr>
              <td style="padding-top:18px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff"
                  style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font-size:16px;font-weight:900;color:#0b1220;margin-bottom:8px;">System details</div>
                      <div style="line-height:1.7;color:#0b1220;">
                        <div><b>Host:</b> ${escapeHtml(host)}</div>
                        <div><b>Agent version:</b> ${escapeHtml(ver)}</div>
                        <div><b>Snapshot time (UTC):</b> ${escapeHtml(snapshotTs)}</div>
                        <div><b>Baseline accepted (UTC):</b> ${escapeHtml(baseline)}</div>
                        <div><b>Transport:</b> ${escapeHtml(transportLabel({}))}</div>
                      </div>
                      <div style="margin-top:10px;font-size:12px;color:#64748b;line-height:1.6;">
                        Debug: status.before.ts=${escapeHtml(p.beforeTs ?? "—")}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding-top:14px;color:#64748b;font-size:12px;line-height:1.5;">
                You’re receiving this because you requested a manual report from VPS Sentry.
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  return { subject, text, html, severity: sev };
}

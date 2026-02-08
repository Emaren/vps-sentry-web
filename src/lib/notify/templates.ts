export type ReportStatusJson = {
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

type ReportEmailInput = {
  requestedBy: string;
  baseUrl: string | null;
  s: ReportStatusJson | null;
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toSafeInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
}

function reportFacts(s: ReportStatusJson | null) {
  const host = s?.host ?? "VPS";
  const ts = s?.ts ?? "—";
  const ver = s?.version ?? "—";
  const baseline = s?.baseline_last_accepted_ts ?? "—";
  const alerts = toSafeInt(s?.alerts_count);
  const ports = toSafeInt(s?.public_ports_count);
  const sshFailed = toSafeInt(s?.auth?.ssh_failed_password);
  const invalidUser = toSafeInt(s?.auth?.ssh_invalid_user);
  const headline = alerts > 0 ? "ACTION NEEDED" : ports > 0 ? "REVIEW" : "OK";
  return { host, ts, ver, baseline, alerts, ports, sshFailed, invalidUser, headline };
}

function truncateLine(v: unknown, max = 240): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

export function buildReportEmailSubject(s: ReportStatusJson | null): string {
  const f = reportFacts(s);
  return `[VPS Sentry] ${f.headline} — ${f.host} (${f.alerts} alerts, ${f.ports} ports, ${f.sshFailed} ssh fails, ${f.invalidUser} invalid users)`;
}

export function buildReportEmailText(params: ReportEmailInput): string {
  const f = reportFacts(params.s);
  const lines: string[] = [];

  lines.push(`VPS Sentry Report`);
  lines.push(`${f.headline}`);
  lines.push(`Requested by: ${params.requestedBy}`);
  lines.push(``);
  lines.push(`Host: ${f.host}`);
  lines.push(`Version: ${f.ver}`);
  lines.push(`Snapshot ts: ${f.ts}`);
  lines.push(`Baseline accepted: ${f.baseline}`);
  lines.push(``);
  lines.push(`Summary:`);
  lines.push(`- Alerts: ${f.alerts}`);
  lines.push(`- Public ports: ${f.ports}`);
  lines.push(`- SSH failed: ${f.sshFailed}`);
  lines.push(`- Invalid user: ${f.invalidUser}`);

  if (Array.isArray(params.s?.alerts) && params.s.alerts.length > 0) {
    lines.push(``);
    lines.push(`Alerts:`);
    for (let i = 0; i < Math.min(10, params.s.alerts.length); i++) {
      const a = params.s.alerts[i];
      lines.push(`${i + 1}) ${truncateLine(a?.title || `Alert ${i + 1}`)}`);
      const detail = truncateLine(a?.detail, 500);
      if (detail) lines.push(detail);
    }
  }

  if (Array.isArray(params.s?.ports_public) && params.s.ports_public.length > 0) {
    lines.push(``);
    lines.push(`Public listeners:`);
    for (let i = 0; i < Math.min(20, params.s.ports_public.length); i++) {
      const p = params.s.ports_public[i];
      lines.push(
        `- ${p?.proto ?? "tcp"} ${p?.host ?? "*"}:${p?.port ?? "?"} (${p?.proc ?? "?"} pid=${p?.pid ?? "?"})`
      );
    }
  }

  if (params.baseUrl) {
    lines.push(``);
    lines.push(`Dashboard: ${params.baseUrl}/dashboard`);
    lines.push(`Status API: ${params.baseUrl}/api/status`);
  }

  return lines.join("\n");
}

function reportTone(headline: string) {
  if (headline === "ACTION NEEDED") return "#dc2626";
  if (headline === "REVIEW") return "#d97706";
  return "#16a34a";
}

function reportBadgeBg(headline: string) {
  if (headline === "ACTION NEEDED") return "#fee2e2";
  if (headline === "REVIEW") return "#fef3c7";
  return "#dcfce7";
}

function renderStat(label: string, value: string) {
  return `<td style="padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#f8fafc;">
    <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${esc(label)}</div>
    <div style="font-size:18px;font-weight:700;color:#111827;">${esc(value)}</div>
  </td>`;
}

export function buildReportEmailHtml(params: ReportEmailInput): string {
  const f = reportFacts(params.s);
  const tone = reportTone(f.headline);
  const badgeBg = reportBadgeBg(f.headline);
  const alerts = Array.isArray(params.s?.alerts) ? params.s.alerts.slice(0, 10) : [];
  const ports = Array.isArray(params.s?.ports_public) ? params.s.ports_public.slice(0, 20) : [];
  const dashboardUrl = params.baseUrl ? `${params.baseUrl}/dashboard` : null;
  const statusUrl = params.baseUrl ? `${params.baseUrl}/api/status` : null;

  const alertsHtml = alerts.length
    ? `<div style="margin-top:16px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:8px;">Top Alerts</div>
        ${alerts
          .map((a, i) => {
            const title = truncateLine(a?.title || `Alert ${i + 1}`);
            const detail = truncateLine(a?.detail, 400);
            return `<div style="padding:10px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;margin-bottom:8px;">
              <div style="font-weight:700;color:#991b1b;font-size:13px;">${i + 1}. ${esc(title)}</div>
              ${
                detail
                  ? `<div style="margin-top:6px;color:#7f1d1d;font-size:12px;line-height:1.5;">${esc(detail)}</div>`
                  : ""
              }
            </div>`;
          })
          .join("")}
      </div>`
    : "";

  const portsHtml = ports.length
    ? `<div style="margin-top:16px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:8px;">Public Listeners</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Proto</th>
              <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Address</th>
              <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Port</th>
              <th align="left" style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Process</th>
            </tr>
          </thead>
          <tbody>
            ${ports
              .map(
                (p) => `<tr>
                    <td style="padding:8px;border-bottom:1px solid #f3f4f6;">${esc(p?.proto ?? "tcp")}</td>
                    <td style="padding:8px;border-bottom:1px solid #f3f4f6;">${esc(p?.host ?? "*")}</td>
                    <td style="padding:8px;border-bottom:1px solid #f3f4f6;">${esc(p?.port ?? "?")}</td>
                    <td style="padding:8px;border-bottom:1px solid #f3f4f6;">${esc(`${p?.proc ?? "?"} (pid=${p?.pid ?? "?"})`)}</td>
                  </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:760px;margin:24px auto;padding:0 12px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 18px;border-bottom:1px solid #e5e7eb;background:#111827;color:#ffffff;">
          <div style="font-size:12px;opacity:0.8;margin-bottom:6px;">VPS Sentry Report</div>
          <div style="font-size:22px;font-weight:800;line-height:1.2;">${esc(f.host)}</div>
          <div style="margin-top:10px;">
            <span style="display:inline-block;background:${esc(badgeBg)};color:${esc(tone)};font-weight:700;font-size:12px;padding:4px 9px;border-radius:999px;">
              ${esc(f.headline)}
            </span>
          </div>
        </div>

        <div style="padding:16px 18px;">
          <div style="color:#4b5563;font-size:13px;line-height:1.6;">
            Requested by <strong>${esc(params.requestedBy)}</strong><br/>
            Snapshot: <strong>${esc(f.ts)}</strong><br/>
            Version: <strong>${esc(f.ver)}</strong><br/>
            Baseline accepted: <strong>${esc(f.baseline)}</strong>
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:14px;border-collapse:separate;border-spacing:8px;">
            <tr>
              ${renderStat("Alerts", String(f.alerts))}
              ${renderStat("Public ports", String(f.ports))}
              ${renderStat("SSH failed", String(f.sshFailed))}
              ${renderStat("Invalid user", String(f.invalidUser))}
            </tr>
          </table>

          ${
            dashboardUrl
              ? `<div style="margin-top:14px;">
                  <a href="${esc(dashboardUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:9px 12px;border-radius:8px;font-size:13px;font-weight:700;">
                    Open Dashboard
                  </a>
                  ${
                    statusUrl
                      ? `<a href="${esc(statusUrl)}" style="display:inline-block;margin-left:8px;background:#ffffff;color:#111827;text-decoration:none;padding:9px 12px;border-radius:8px;font-size:13px;font-weight:700;border:1px solid #d1d5db;">
                          View Status API
                        </a>`
                      : ""
                  }
                </div>`
              : ""
          }

          ${alertsHtml}
          ${portsHtml}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export function buildOpsTestEmailBodies(params: {
  host: string;
  nowIso: string;
  baseUrl: string | null;
}) {
  const textLines = [
    "VPS Sentry test email",
    "",
    "If you received this, SMTP delivery is working.",
    `Time: ${params.nowIso}`,
    `Host: ${params.host}`,
    params.baseUrl ? `Dashboard: ${params.baseUrl}/dashboard` : "",
  ].filter(Boolean);

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:640px;margin:24px auto;padding:0 12px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 18px;background:#111827;color:#ffffff;">
          <div style="font-size:12px;opacity:0.85;">VPS Sentry</div>
          <div style="font-size:22px;font-weight:800;line-height:1.2;margin-top:4px;">SMTP Test Email</div>
        </div>
        <div style="padding:16px 18px;color:#111827;font-size:14px;line-height:1.7;">
          <p style="margin:0 0 12px 0;">If you received this, SMTP delivery is working.</p>
          <p style="margin:0;">
            <strong>Time:</strong> ${esc(params.nowIso)}<br/>
            <strong>Host:</strong> ${esc(params.host)}
          </p>
          ${
            params.baseUrl
              ? `<p style="margin:12px 0 0 0;">
                  <a href="${esc(`${params.baseUrl}/dashboard`)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:700;">
                    Open Dashboard
                  </a>
                </p>`
              : ""
          }
        </div>
      </div>
    </div>
  </body>
</html>`;

  return {
    text: textLines.join("\n"),
    html,
  };
}

export function buildNotifyTestEmailBodies(params: {
  title: string;
  detail: string;
  payload: unknown;
}) {
  const payloadPretty = JSON.stringify(params.payload, null, 2);
  const text = `${params.title}\n\n${params.detail}\n\n${payloadPretty}`;
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:700px;margin:24px auto;padding:0 12px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 18px;background:#111827;color:#ffffff;">
          <div style="font-size:12px;opacity:0.85;">VPS Sentry</div>
          <div style="font-size:20px;font-weight:800;line-height:1.2;margin-top:4px;">${esc(params.title)}</div>
        </div>
        <div style="padding:16px 18px;color:#111827;font-size:14px;line-height:1.7;">
          <p style="margin:0 0 12px 0;">${esc(params.detail)}</p>
          <div style="font-size:12px;color:#4b5563;margin-bottom:6px;">Payload</div>
          <pre style="margin:0;padding:12px;border-radius:8px;background:#0f172a;color:#e5e7eb;overflow:auto;font-size:12px;line-height:1.5;">${esc(payloadPretty)}</pre>
        </div>
      </div>
    </div>
  </body>
</html>`;

  return { text, html };
}

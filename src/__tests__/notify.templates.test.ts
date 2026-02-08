import { describe, expect, it } from "vitest";
import {
  buildNotifyTestEmailBodies,
  buildOpsTestEmailBodies,
  buildReportEmailHtml,
  buildReportEmailSubject,
  buildReportEmailText,
} from "@/lib/notify/templates";

describe("notify email templates", () => {
  it("builds report subject with full counters", () => {
    const subject = buildReportEmailSubject({
      host: "ubuntu-1",
      alerts_count: 4,
      public_ports_count: 1,
      auth: { ssh_failed_password: 2, ssh_invalid_user: 7 },
    });

    expect(subject).toContain("ACTION NEEDED");
    expect(subject).toContain("4 alerts");
    expect(subject).toContain("1 ports");
    expect(subject).toContain("2 ssh fails");
    expect(subject).toContain("7 invalid users");
  });

  it("escapes unsafe html in report body while preserving details", () => {
    const html = buildReportEmailHtml({
      requestedBy: "ops@example.com",
      baseUrl: "https://vps.example.com",
      s: {
        host: "node<1>",
        alerts_count: 1,
        public_ports_count: 0,
        auth: { ssh_failed_password: 0, ssh_invalid_user: 0 },
        alerts: [{ title: "<script>alert(1)</script>", detail: "xss <b>attempt</b>" }],
      },
    });

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Open Dashboard");
  });

  it("builds text/html variants for test and notify messages", () => {
    const ops = buildOpsTestEmailBodies({
      host: "ubuntu-ops",
      nowIso: "2026-02-08T00:00:00.000Z",
      baseUrl: "https://vps.example.com",
    });
    expect(ops.text).toContain("SMTP delivery is working");
    expect(ops.html).toContain("SMTP Test Email");

    const notify = buildNotifyTestEmailBodies({
      title: "Notify test",
      detail: "Detail here",
      payload: { ok: true, env: "prod" },
    });
    expect(notify.text).toContain("Notify test");
    expect(notify.html).toContain("Payload");
  });

  it("builds report text with key signal fields", () => {
    const text = buildReportEmailText({
      requestedBy: "ops@example.com",
      baseUrl: null,
      s: {
        host: "node-1",
        alerts_count: 2,
        public_ports_count: 3,
        auth: { ssh_failed_password: 5, ssh_invalid_user: 1 },
      },
    });

    expect(text).toContain("Requested by: ops@example.com");
    expect(text).toContain("- Alerts: 2");
    expect(text).toContain("- Public ports: 3");
    expect(text).toContain("- SSH failed: 5");
    expect(text).toContain("- Invalid user: 1");
  });
});

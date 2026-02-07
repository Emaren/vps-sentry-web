// /var/www/vps-sentry-web/src/app/dashboard/dashboard-actions.tsx
"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

type JsonResponse = {
  message?: string;
  error?: string;
};

const linkStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
  background: "var(--dash-btn-bg, rgba(255,255,255,0.04))",
  color: "inherit",
  textDecoration: "none",
  fontWeight: 800,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
  background: "var(--dash-btn-bg-strong, rgba(255,255,255,0.06))",
  color: "inherit",
  fontWeight: 800,
  cursor: "pointer",
};

async function postJson(path: string) {
  const res = await fetch(path, { method: "POST" });
  const data: JsonResponse = await res.json().catch(() => ({} as JsonResponse));
  if (!res.ok) throw new Error(data?.error || `${path} ${res.status}`);
  return data;
}

function asErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

async function sendTestEmail() {
  try {
    await postJson("/api/ops/test-email");
    alert("✅ Test email sent.");
  } catch (e: unknown) {
    console.error(e);
    alert(asErrorMessage(e, "Failed to send test email"));
  }
}

async function sendReportNow() {
  try {
    const data = await postJson("/api/ops/report-now");
    alert(data?.message ?? "✅ Report triggered.");
  } catch (e: unknown) {
    console.error(e);
    alert(asErrorMessage(e, "Failed to trigger report"));
  }
}

export default function DashboardActions() {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
      <Link href="/" style={linkStyle}>
        ← Back to landing
      </Link>

      <Link href="/billing" style={linkStyle}>
        Billing
      </Link>

      <Link href="/hosts" style={linkStyle}>
        Hosts
      </Link>

      <button type="button" onClick={sendTestEmail} style={buttonStyle}>
        Send test email
      </button>

      <button type="button" onClick={sendReportNow} style={buttonStyle}>
        Send report now
      </button>

      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        style={buttonStyle}
      >
        Logout
      </button>
    </div>
  );
}

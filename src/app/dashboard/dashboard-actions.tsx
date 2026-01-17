// /var/www/vps-sentry-web/src/app/dashboard/dashboard-actions.tsx
"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

const linkStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.04)",
  color: "inherit",
  textDecoration: "none",
  fontWeight: 800,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  fontWeight: 800,
  cursor: "pointer",
};

async function openBillingPortal() {
  try {
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok) throw new Error(data?.error || `portal ${res.status}`);
    if (!data?.url) throw new Error("Missing portal url");
    window.location.href = data.url;
  } catch (e: any) {
    console.error(e);
    alert(e?.message ?? "Failed to open billing portal");
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

      <button type="button" onClick={openBillingPortal} style={buttonStyle}>
        Manage subscription
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

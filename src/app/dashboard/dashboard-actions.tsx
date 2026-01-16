// /var/www/vps-sentry-web/src/app/dashboard/dashboard-actions.tsx
"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

export default function DashboardActions() {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
      <Link
        href="/"
        style={{
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(255,255,255,0.04)",
          color: "inherit",
          textDecoration: "none",
          fontWeight: 800,
        }}
      >
        ← Back to landing
      </Link>

      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        style={{
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(255,255,255,0.06)",
          color: "inherit",
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        Logout
      </button>
    </div>
  );
}

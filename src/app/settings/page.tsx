// src/app/settings/page.tsx
import React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <main className="dashboard-shell dashboard-main" style={{ maxWidth: 980 }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>Settings</h1>
      <div style={{ opacity: 0.75, marginTop: 8 }}>
        Notification preferences live here (presets + toggles). We’ll wire this to Prisma next.
      </div>

      <div
        style={{
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 14,
          padding: 14,
          background: "rgba(255,255,255,0.03)",
          marginTop: 14,
        }}
      >
        <div style={{ fontWeight: 900 }}>Presets</div>
        <ul style={{ marginTop: 10, paddingLeft: 18, opacity: 0.8 }}>
          <li><b>Normal</b>: email on critical/high, immediate</li>
          <li><b>Paranoid</b>: email on everything, immediate</li>
          <li><b>Quiet</b>: daily digest only</li>
        </ul>

        <div style={{ fontWeight: 900, marginTop: 14 }}>Coming next</div>
        <ul style={{ marginTop: 10, paddingLeft: 18, opacity: 0.8 }}>
          <li>Email on/off, Discord on/off</li>
          <li>Severity thresholds</li>
          <li>Quiet hours</li>
          <li>Max alerts per hour/day</li>
          <li>Notify on: ports/auth/file changes/processes</li>
        </ul>
      </div>
    </main>
  );
}

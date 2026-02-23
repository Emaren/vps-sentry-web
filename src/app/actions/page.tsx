import React from "react";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import SiteThemeControls from "@/app/_components/SiteThemeControls";
import DashboardLogoutButton from "@/app/dashboard/_components/DashboardLogoutButton";
import { requireViewerAccess } from "@/lib/rbac";
import { hasRequiredRole } from "@/lib/rbac-policy";

import ActionsConsole from "./ActionsConsole";
import ArchiveFolderCard from "./ArchiveFolderCard";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const access = await requireViewerAccess();
  if (!access.ok) redirect("/login");

  const signedInAs = access.identity.email ?? "user";
  const canOpenAdmin = hasRequiredRole(access.identity.role, "admin");

  return (
    <main className="dashboard-shell dashboard-main">
      <div className="app-header">
        <div className="app-header-brand">
          <Link href="/" aria-label="VPS Sentry home" className="app-header-logo-link">
            <Image
              src="/vps-sentry-logo.png"
              alt="VPS Sentry logo"
              width={52}
              height={52}
              priority
              className="app-header-logo"
            />
          </Link>
          <div className="app-header-copy">
            <h1 className="app-header-title">Actions</h1>
            <p className="app-header-subtitle">Operator command deck for VPS Sentry abilities</p>
            <p className="app-header-meta">
              Run allowlisted commands from the web UI and inspect live responses.
            </p>
          </div>
        </div>

        <div className="app-header-actions app-header-actions-with-theme">
          <div className="app-header-actions-row">
            <Link href="/dashboard" className="app-header-btn">
              Dashboard
            </Link>
            <Link href="/hosts" className="app-header-btn">
              Hosts
            </Link>
            <Link href="/billing" className="app-header-btn">
              Billing
            </Link>
            <Link href="/get-vps-sentry" className="app-header-btn">
              Install guide
            </Link>
            {canOpenAdmin ? (
              <Link href="/admin" className="app-header-btn">
                Admin
              </Link>
            ) : null}
            <DashboardLogoutButton />
          </div>
          <div className="app-header-actions-theme-row">
            <SiteThemeControls variant="inline" />
          </div>
        </div>
      </div>

      <ArchiveFolderCard userRole={access.identity.role} />
      <ActionsConsole userRole={access.identity.role} signedInAs={signedInAs} />
    </main>
  );
}

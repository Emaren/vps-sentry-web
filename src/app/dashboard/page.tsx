// /var/www/vps-sentry-web/src/app/dashboard/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { requireViewerAccess } from "@/lib/rbac";
import { hasRequiredRole } from "@/lib/rbac-policy";
import { readFleetProjection } from "@/lib/kingdom-os/reader";

import DashboardView from "./_components/DashboardView";
import {
  getDashboardOpsSnapshot,
  getStatusEnvelopeSafe,
  getUserBilling,
} from "./_lib/fetch";
import type {
  DashboardBilling,
  DashboardEnv,
  DashboardOpsSnapshot,
} from "./_lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const access = await requireViewerAccess();
  if (!access.ok) redirect("/login");

  const email = access.identity.email ?? null;
  const signedInAs = email ?? "user";

  // Fetch in parallel (env does not depend on billing)
  const [env, billing, ops, fleet] = await Promise.all([
    getStatusEnvelopeSafe(),
    getUserBilling(email),
    getDashboardOpsSnapshot({
      userId: access.identity.userId,
      userEmail: access.identity.email ?? null,
      userRole: access.identity.role,
    }),
    hasRequiredRole(access.identity.role, "ops")
      ? readFleetProjection().catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <DashboardView
      env={env as DashboardEnv}
      billing={billing as DashboardBilling}
      ops={ops as DashboardOpsSnapshot}
      signedInAs={signedInAs}
      fleet={fleet}
      userRole={access.identity.role}
    />
  );
}

// /var/www/vps-sentry-web/src/app/dashboard/page.tsx
import React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

import DashboardView from "./_components/DashboardView";
import { getStatusEnvelopeSafe, getUserBilling } from "./_lib/fetch";
import type { DashboardBilling, DashboardEnv } from "./_lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const email = session.user.email ?? null;
  const signedInAs = email ?? session.user.name ?? "user";

  // Fetch in parallel (env does not depend on billing)
  const [env, billing] = await Promise.all([
    getStatusEnvelopeSafe(),
    getUserBilling(email),
  ]);

  return (
    <DashboardView
      env={env as DashboardEnv}
      billing={billing as DashboardBilling}
      signedInAs={signedInAs}
    />
  );
}

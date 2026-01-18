// /var/www/vps-sentry-web/src/app/dashboard/page.tsx
import React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

import DashboardView from "./_components/DashboardView";
import { getStatusEnvelopeSafe, getUserBilling } from "./_lib/fetch";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const env = await getStatusEnvelopeSafe();

  const email = session.user?.email ?? null;
  const billing = await getUserBilling(email);

  const signedInAs = session.user?.email ?? session.user?.name ?? "user";

  return <DashboardView env={env as any} billing={billing} signedInAs={signedInAs} />;
}

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SiteThemeControls from "@/app/_components/SiteThemeControls";
import NewHostClient from "./NewHostClient";

export const dynamic = "force-dynamic";

export default async function NewHostPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      hostLimit: true,
      hosts: {
        select: { id: true },
      },
    },
  });

  if (!user) redirect("/login");

  const currentHosts = user.hosts.length;
  const hostLimit = user.hostLimit ?? 1;

  return (
    <main style={{ padding: 16, maxWidth: 1060, margin: "0 auto" }}>
      <div className="app-header">
        <div className="app-header-brand">
          <Link href="/" aria-label="VPS Sentry home" className="app-header-logo-link">
            <Image
              src="/vps-sentry-logo.png"
              alt="VPS Sentry logo"
              width={56}
              height={56}
              priority
              className="app-header-logo"
            />
          </Link>
          <div className="app-header-copy">
            <h1 className="app-header-title">Add Host</h1>
            <p className="app-header-subtitle">
              Create a host, get a one-time API token, and install the auto-push hook.
            </p>
            <p className="app-header-meta">Connect a new VPS and start streaming snapshots into your dashboard.</p>
          </div>
        </div>

        <div className="app-header-actions app-header-actions-with-theme">
          <div className="app-header-actions-row">
            <Link href="/dashboard" className="app-header-btn">
              Dashboard
            </Link>
            <Link href="/billing" className="app-header-btn">
              Billing
            </Link>
            <Link href="/get-vps-sentry" className="app-header-btn">
              Install guide
            </Link>
            <Link href="/hosts" className="app-header-btn">
              Back to hosts
            </Link>
          </div>
          <div className="app-header-actions-theme-row">
            <SiteThemeControls variant="inline" />
          </div>
        </div>
      </div>

      <NewHostClient
        defaultName={`vps-${currentHosts + 1}`}
        currentHosts={currentHosts}
        hostLimit={hostLimit}
      />
    </main>
  );
}

import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SiteThemeControls from "@/app/_components/SiteThemeControls";
import BillingActions from "./ui/BillingActions";

export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      email: true,
      name: true,
      plan: true,
      hostLimit: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
    },
  });

  if (!user) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-[1060px] px-4 py-6 sm:px-6 sm:py-8">
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
            <h1 className="app-header-title">Billing</h1>
            <p className="app-header-subtitle">
              Signed in as <span className="font-medium">{user.email}</span>
            </p>
            <p className="app-header-meta">Manage plan, limits, and Stripe subscription settings.</p>
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
            <Link href="/get-vps-sentry" className="app-header-btn">
              Install guide
            </Link>
          </div>
          <div className="app-header-actions-theme-row">
            <SiteThemeControls variant="inline" />
          </div>
        </div>
      </div>

      {/* Current plan box: INFO + Manage subscription ONLY */}
      <div className="mt-6 rounded-lg border p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <div className="text-sm">
            <span className="opacity-70">Current plan:</span>{" "}
            <span className="font-semibold">{user.plan ?? "FREE"}</span>
          </div>
          <div className="text-sm">
            <span className="opacity-70">Status:</span>{" "}
            <span className="font-medium">{user.subscriptionStatus ?? "Trial"}</span>
          </div>
          <div className="text-sm">
            <span className="opacity-70">Host limit:</span>{" "}
            <span className="font-medium">{user.hostLimit ?? 1}</span>
          </div>
          <div className="text-sm">
            <span className="opacity-70">Renews/ends:</span>{" "}
            <span className="font-medium">
              {user.currentPeriodEnd ? new Date(user.currentPeriodEnd).toLocaleString() : "—"}
            </span>
          </div>
        </div>

        <div className="mt-4">
          <BillingActions mode="portal" />
        </div>
      </div>

      {/* Plan cards: Upgrade ONLY */}
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-5">
          <h2 className="text-lg font-semibold">$4 BASIC</h2>
          <p className="mt-1 text-sm opacity-80">For solo builders.</p>
          <ul className="mt-3 list-disc pl-5 text-sm opacity-90">
            <li>3 hosts</li>
            <li>Email + Discord alerts</li>
            <li>Baseline + diffs</li>
          </ul>
          <div className="mt-4">
            <BillingActions mode="upgrade" defaultPlan="BASIC" />
          </div>
        </div>

        <div className="rounded-lg border p-5">
          <h2 className="text-lg font-semibold">$9 PRO</h2>
          <p className="mt-1 text-sm opacity-80">For agencies / multiple VPS.</p>
          <ul className="mt-3 list-disc pl-5 text-sm opacity-90">
            <li>4+ hosts</li>
            <li>Priority monitoring features</li>
            <li>More headroom</li>
          </ul>
          <div className="mt-4">
            <BillingActions mode="upgrade" defaultPlan="PRO" />
          </div>
        </div>
      </div>

      <p className="mt-8 text-xs opacity-70">
        If you already subscribed, use “Manage subscription” to update/cancel in Stripe.
      </p>
    </main>
  );
}

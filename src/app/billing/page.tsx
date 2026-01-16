import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p className="mt-2 text-sm opacity-80">
        Signed in as <span className="font-medium">{user.email}</span>
      </p>

      <div className="mt-6 rounded-lg border p-4">
        <div className="flex flex-col gap-1">
          <div className="text-sm">
            <span className="opacity-70">Current plan:</span>{" "}
            <span className="font-semibold">{user.plan ?? "FREE"}</span>
          </div>
          <div className="text-sm">
            <span className="opacity-70">Status:</span>{" "}
            <span className="font-medium">{user.subscriptionStatus ?? "Basic"}</span>
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
          <BillingActions />
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-5">
          <h2 className="text-lg font-semibold">PRO</h2>
          <p className="mt-1 text-sm opacity-80">For solo builders.</p>
          <ul className="mt-3 list-disc pl-5 text-sm opacity-90">
            <li>10 hosts</li>
            <li>Email + Discord alerts</li>
            <li>Baseline + diffs</li>
          </ul>
          <div className="mt-4">
            <BillingActions defaultPlan="PRO" />
          </div>
        </div>

        <div className="rounded-lg border p-5">
          <h2 className="text-lg font-semibold">ELITE</h2>
          <p className="mt-1 text-sm opacity-80">For agencies / multiple VPS.</p>
          <ul className="mt-3 list-disc pl-5 text-sm opacity-90">
            <li>50 hosts</li>
            <li>Priority monitoring features</li>
            <li>More headroom</li>
          </ul>
          <div className="mt-4">
            <BillingActions defaultPlan="ELITE" />
          </div>
        </div>
      </div>

      <p className="mt-8 text-xs opacity-70">
        If you already subscribed, use “Manage subscription” to update/cancel in Stripe.
      </p>
    </main>
  );
}

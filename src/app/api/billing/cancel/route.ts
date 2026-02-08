// /var/www/vps-sentry-web/src/app/api/billing/cancel/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { requireOwnerAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";

function requireEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : null;
}

function stripeConfigured(): boolean {
  return Boolean(requireEnv("STRIPE_SECRET_KEY"));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured (missing STRIPE_SECRET_KEY)." },
      { status: 500 }
    );
  }

  const access = await requireOwnerAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "billing.cancel.denied",
      detail: `status=${access.status} role=${access.role ?? "unknown"} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/billing/cancel",
        status: access.status,
        requiredRole: "owner",
        email: access.email ?? null,
        role: access.role ?? null,
      },
    });
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const user = await prisma.user.findUnique({
    where: { id: access.identity.userId },
    select: {
      id: true,
      stripeCustomerId: true,
      subscriptionId: true,
    },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Try to find a subscription id: prefer DB, else look up by customer
  let subscriptionId: string | null = user.subscriptionId?.trim() || null;

  if (!subscriptionId) {
    const customerId: string | null = user.stripeCustomerId?.trim() || null;
    if (!customerId) {
      return NextResponse.json({ error: "No Stripe customer on file" }, { status: 400 });
    }

    const subs = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
    const active = subs.data.find((s) => s.status === "active" || s.status === "trialing");
    subscriptionId = active?.id ?? null;
  }

  if (!subscriptionId) {
    return NextResponse.json({ error: "No active subscription found" }, { status: 400 });
  }

  // Cancel at period end (safe default)
  const updated = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });

  // Best-effort DB update (schema may vary)
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        subscriptionId,
        subscriptionStatus: "CANCEL_AT_PERIOD_END",
      },
    });
  } catch (err: unknown) {
    console.warn("[billing.cancel] failed to persist cancel state:", errorMessage(err));
    // ignore schema mismatch
  }

  await writeAuditLog({
    req,
    userId: access.identity.userId,
    action: "billing.cancel.request",
    detail: `Cancel-at-period-end requested for ${updated.id}`,
    meta: {
      route: "/api/billing/cancel",
      subscriptionId: updated.id,
    },
  });

  return NextResponse.json({ ok: true, subscriptionId: updated.id });
}

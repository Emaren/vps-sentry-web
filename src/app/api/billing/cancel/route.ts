// /var/www/vps-sentry-web/src/app/api/billing/cancel/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

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

export async function POST() {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured (missing STRIPE_SECRET_KEY)." },
      { status: 500 }
    );
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email },
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

  return NextResponse.json({ ok: true, subscriptionId: updated.id });
}

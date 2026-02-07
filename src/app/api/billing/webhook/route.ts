// src/app/api/billing/webhook/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Stripe Webhook (LIVE)
 *
 * Endpoint URL in Stripe should be:
 *   https://vps-sentry.tokentap.ca/api/billing/webhook
 *
 * Env required (systemd EnvironmentFile=/etc/vps-sentry-web.env):
 *   STRIPE_WEBHOOK_SECRET=whsec_...
 *   STRIPE_PRICE_PRO_MONTHLY=price_...
 *   STRIPE_PRICE_ELITE_MONTHLY=price_...
 */
export async function POST(req: Request) {
  const requestId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  const sig = (await headers()).get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { error: "Missing stripe-signature", requestId },
      { status: 400 }
    );
  }

  const whsec = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!whsec) {
    // Misconfigured server. Stripe will keep retrying, so fail loudly.
    return NextResponse.json(
      {
        error: "Webhook not configured (missing STRIPE_WEBHOOK_SECRET)",
        hint: "Set STRIPE_WEBHOOK_SECRET=whsec_... in /etc/vps-sentry-web.env and restart vps-sentry-web.service.",
        requestId,
      },
      { status: 500 }
    );
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    // This MUST use the raw text body (not JSON) to validate the signature.
    event = stripe.webhooks.constructEvent(body, sig, whsec);
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: "Webhook signature verification failed",
        detail: errorMessage(err),
        requestId,
      },
      { status: 400 }
    );
  }

  // Helpers
  const proPrice = process.env.STRIPE_PRICE_PRO_MONTHLY?.trim() || null;
  const elitePrice = process.env.STRIPE_PRICE_ELITE_MONTHLY?.trim() || null;

  function planFromMetaOrPrice(sub: Stripe.Subscription): "PRO" | "ELITE" | "FREE" {
    const metaPlan = String(sub.metadata?.plan ?? "")
      .toUpperCase()
      .trim();

    if (metaPlan === "ELITE") return "ELITE";
    if (metaPlan === "PRO") return "PRO";

    const priceId = sub.items.data[0]?.price?.id ?? null;
    if (elitePrice && priceId === elitePrice) return "ELITE";
    if (proPrice && priceId === proPrice) return "PRO";

    // Default if we can’t resolve cleanly
    return "PRO";
  }

  function hostLimitFor(plan: "PRO" | "ELITE" | "FREE"): number {
    if (plan === "ELITE") return 50;
    if (plan === "PRO") return 10;
    return 1;
  }

  function isActiveStatus(status: Stripe.Subscription.Status): boolean {
    return status === "active" || status === "trialing";
  }

  async function applySubscription(sub: Stripe.Subscription) {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const metaUserId = (sub.metadata?.userId as string | undefined)?.trim() || null;

    const priceId = sub.items.data[0]?.price?.id ?? "unknown";
    const resolvedPlan = planFromMetaOrPrice(sub);

    // Stripe object shape differs by API version; be tolerant.
    const subAny = sub as unknown as Record<string, unknown>;
    const periodEnd =
      typeof subAny.current_period_end === "number"
        ? new Date(subAny.current_period_end * 1000)
        : null;

    const user =
      metaUserId
        ? await prisma.user.findUnique({ where: { id: metaUserId } })
        : await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });

    if (!user) return;

    const active = isActiveStatus(sub.status);
    const finalPlan: "FREE" | "PRO" | "ELITE" = active ? resolvedPlan : "FREE";
    const hostLimit = active ? hostLimitFor(resolvedPlan) : 1;
    const persistedPlan: "FREE" | "BASIC" | "PRO" =
      finalPlan === "ELITE" ? "PRO" : finalPlan;

    // Subscription row (keeps history/state per user)
    await prisma.subscription.upsert({
      where: { userId: user.id },
      update: {
        stripeCustomerId: customerId,
        stripeSubId: sub.id,
        status: sub.status,
        priceId,
        currentPeriodEnd: periodEnd,
      },
      create: {
        userId: user.id,
        stripeCustomerId: customerId,
        stripeSubId: sub.id,
        status: sub.status,
        priceId,
        currentPeriodEnd: periodEnd,
      },
    });

    // User "fast path" fields for app gating
    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeCustomerId: customerId,
        subscriptionId: sub.id,
        subscriptionStatus: sub.status,
        currentPeriodEnd: periodEnd,
        plan: persistedPlan,
        hostLimit,
      },
    });
  }

  async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    // Optional but very useful: checkout.session.completed can arrive before sub events
    // (or if sub events are not selected). We pull the subscription and apply it.
    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;

    if (!subId) return;

    const sub = await stripe.subscriptions.retrieve(subId);
    await applySubscription(sub);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      }

      // You can add these later if you want stricter billing truth:
      // case "invoice.payment_succeeded":
      // case "invoice.payment_failed":
      // case "customer.subscription.trial_will_end":
      default:
        break;
    }
  } catch (err: unknown) {
    // Stripe will retry on 5xx; return 500 so you don’t silently miss state updates.
    return NextResponse.json(
      {
        error: "Webhook handler failed",
        detail: errorMessage(err),
        eventType: event.type,
        requestId,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true, requestId });
}

// /var/www/vps-sentry-web/src/app/api/billing/checkout/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

type Plan = "PRO" | "ELITE";

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function normalizePlan(input: unknown): Plan {
  const p = String(input ?? "").toUpperCase();
  return p === "ELITE" ? "ELITE" : "PRO";
}

function requireEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : null;
}

function getAppUrl(): string | null {
  // APP_URL preferred; NEXTAUTH_URL fallback
  return requireEnv("APP_URL") ?? requireEnv("NEXTAUTH_URL");
}

function stripeConfigured(): boolean {
  return Boolean(requireEnv("STRIPE_SECRET_KEY"));
}

/**
 * Ensure the User has a Stripe Customer in the CURRENT Stripe mode (LIVE vs TEST).
 * If the DB has a stale customerId from the other mode/account, Stripe throws:
 *   "No such customer: cus_..."
 *
 * This will "self-heal" by clearing the stale ID, creating a new customer, and persisting it.
 */
async function ensureStripeCustomer(user: {
  id: string;
  email: string | null;
  stripeCustomerId: string | null;
}) {
  const existing = user.stripeCustomerId?.trim() || null;

  if (existing) {
    try {
      const c = await stripe.customers.retrieve(existing);
      const anyC = c as any;
      if (anyC?.deleted) {
        throw Object.assign(new Error("Customer is deleted"), {
          code: "resource_missing",
        });
      }
      return existing;
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const code = String(e?.code ?? "");

      // This is the specific class we want to auto-heal:
      // - customer exists in DB, but not in this Stripe mode/account (LIVE vs TEST)
      if (code === "resource_missing" || msg.toLowerCase().includes("no such customer")) {
        // clear stale ID
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: null },
        });

        // create fresh customer
        const created = await stripe.customers.create({
          email: user.email ?? undefined,
          metadata: { userId: user.id },
        });

        // persist
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: created.id },
        });

        return created.id;
      }

      throw e;
    }
  }

  // No customer yet -> create
  const created = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: created.id },
  });

  return created.id;
}

export async function POST(req: Request) {
  const rid = requestId();

  // -----------------------------
  // 0) Friendly Stripe config guard
  // -----------------------------
  if (!stripeConfigured()) {
    return NextResponse.json(
      {
        error: "Stripe is not configured (missing STRIPE_SECRET_KEY).",
        hint:
          "Set STRIPE_SECRET_KEY in /etc/vps-sentry-web.env (loaded by systemd EnvironmentFile) and restart vps-sentry-web.service.",
        requestId: rid,
      },
      { status: 500 }
    );
  }

  try {
    // -----------------------------
    // 1) Auth gate
    // -----------------------------
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.trim();
    if (!email) return NextResponse.json({ error: "Unauthorized", requestId: rid }, { status: 401 });

    // -----------------------------
    // 2) Load user
    // -----------------------------
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
      },
    });

    if (!user) return NextResponse.json({ error: "User not found", requestId: rid }, { status: 404 });

    // -----------------------------
    // 3) Parse requested plan (default PRO)
    // -----------------------------
    let plan: Plan = "PRO";
    try {
      const body = await req.json().catch(() => null);
      plan = normalizePlan(body?.plan);
    } catch {
      // ignore; default PRO
    }

    // -----------------------------
    // 4) Resolve priceId from env
    // -----------------------------
    const proPrice = requireEnv("STRIPE_PRICE_PRO_MONTHLY");
    const elitePrice = requireEnv("STRIPE_PRICE_ELITE_MONTHLY");

    const priceId = plan === "ELITE" ? elitePrice : proPrice;

    if (!priceId) {
      return NextResponse.json(
        {
          error: `Missing Stripe price env for ${plan}`,
          hint:
            plan === "ELITE"
              ? "Set STRIPE_PRICE_ELITE_MONTHLY in /etc/vps-sentry-web.env (LIVE price id in Live mode)."
              : "Set STRIPE_PRICE_PRO_MONTHLY in /etc/vps-sentry-web.env (LIVE price id in Live mode).",
          requestId: rid,
        },
        { status: 500 }
      );
    }

    // -----------------------------
    // 5) App URL for redirect links
    // -----------------------------
    const appUrl = getAppUrl();
    if (!appUrl) {
      return NextResponse.json(
        {
          error: "Missing APP_URL (or NEXTAUTH_URL) env var",
          hint: "Set APP_URL=https://vps-sentry.tokentap.ca in /etc/vps-sentry-web.env (recommended).",
          requestId: rid,
        },
        { status: 500 }
      );
    }

    // -----------------------------
    // 6) Ensure Stripe customer exists (and is valid in this Stripe mode)
    // -----------------------------
    let customerId: string;
    try {
      customerId = await ensureStripeCustomer(user);
    } catch (err: any) {
      return NextResponse.json(
        {
          error: "Failed to create/validate Stripe customer",
          detail: err?.message ?? String(err),
          requestId: rid,
          hint: "Verify STRIPE_SECRET_KEY is correct and the Stripe account is in the intended mode (Live vs Test).",
        },
        { status: 500 }
      );
    }

    // -----------------------------
    // 7) Create checkout session (subscription)
    // -----------------------------
    try {
      const checkout = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],

        success_url: `${appUrl.replace(/\/$/, "")}/dashboard?billing=success`,
        cancel_url: `${appUrl.replace(/\/$/, "")}/billing?billing=cancel`,

        allow_promotion_codes: true,

        subscription_data: {
          metadata: { userId: user.id, plan },
        },
        metadata: { userId: user.id, plan },
      });

      return NextResponse.json({ url: checkout.url, requestId: rid });
    } catch (err: any) {
      return NextResponse.json(
        {
          error: "Failed to create Stripe Checkout Session",
          detail: err?.message ?? String(err),
          requestId: rid,
          hint:
            "Ensure STRIPE_SECRET_KEY + STRIPE_PRICE_* are from the SAME Stripe mode (Live with Live, Test with Test). " +
            "Also confirm the Price is active and recurring (monthly).",
          context: {
            plan,
            customerId,
            priceId,
          },
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Unhandled billing/checkout error",
        detail: err?.message ?? String(err),
        requestId: rid,
      },
      { status: 500 }
    );
  }
}

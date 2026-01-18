// /var/www/vps-sentry-web/src/app/api/billing/checkout/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

type Plan = "BASIC" | "PRO";

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function normalizePlan(input: unknown): Plan {
  const p = String(input ?? "").toUpperCase();
  if (p === "BASIC") return "BASIC";
  return "PRO";
}

function envTrim(name: string): string | null {
  const v = process.env[name];
  const t = v?.trim();
  return t && t.length ? t : null;
}

function getAppUrl(): string | null {
  return envTrim("APP_URL") ?? envTrim("NEXTAUTH_URL");
}

function stripeConfigured(): boolean {
  return Boolean(envTrim("STRIPE_SECRET_KEY"));
}

function getPriceId(plan: Plan): string | null {
  // Prefer MONTHLY vars if you have them, but allow your older names too.
  const basic =
    envTrim("STRIPE_PRICE_BASIC_MONTHLY") ??
    envTrim("STRIPE_PRICE_BASIC") ??
    "price_1SqQ5rHvc4wl41HLoltMTzdK"; // fallback you were using

  const pro =
    envTrim("STRIPE_PRICE_PRO_MONTHLY") ??
    envTrim("STRIPE_PRICE_PRO") ??
    null;

  return plan === "BASIC" ? basic : pro;
}

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

      if (code === "resource_missing" || msg.toLowerCase().includes("no such customer")) {
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: null },
        });

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

      throw e;
    }
  }

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

  if (!stripeConfigured()) {
    return NextResponse.json(
      {
        error: "Stripe is not configured (missing STRIPE_SECRET_KEY).",
        requestId: rid,
      },
      { status: 500 }
    );
  }

  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.trim();
    if (!email) return NextResponse.json({ error: "Unauthorized", requestId: rid }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, stripeCustomerId: true },
    });

    if (!user) return NextResponse.json({ error: "User not found", requestId: rid }, { status: 404 });

    let plan: Plan = "PRO";
    const body = (await req.json().catch(() => null)) as any;
    plan = normalizePlan(body?.plan);

    const priceId = getPriceId(plan);
    if (!priceId) {
      return NextResponse.json(
        {
          error: `Stripe price not configured for ${plan}`,
          hint:
            plan === "PRO"
              ? "Set STRIPE_PRICE_PRO_MONTHLY (or STRIPE_PRICE_PRO) in /etc/vps-sentry-web.env"
              : "Set STRIPE_PRICE_BASIC_MONTHLY (or STRIPE_PRICE_BASIC) in /etc/vps-sentry-web.env",
          requestId: rid,
        },
        { status: 500 }
      );
    }

    const appUrl = getAppUrl();
    if (!appUrl) {
      return NextResponse.json(
        {
          error: "Missing APP_URL (or NEXTAUTH_URL) env var",
          requestId: rid,
        },
        { status: 500 }
      );
    }

    const base = appUrl.replace(/\/$/, "");
    const customerId = await ensureStripeCustomer(user);

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],

      success_url: `${base}/dashboard?billing=success`,
      cancel_url: `${base}/billing?billing=cancel`,

      allow_promotion_codes: true,

      subscription_data: {
        metadata: { userId: user.id, plan },
      },
      metadata: { userId: user.id, plan },
    });

    if (!checkout.url) {
      return NextResponse.json(
        { error: "Stripe checkout missing url", requestId: rid },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: checkout.url, requestId: rid });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err), requestId: rid },
      { status: 500 }
    );
  }
}

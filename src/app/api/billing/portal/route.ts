// /var/www/vps-sentry-web/src/app/api/billing/portal/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

// Ensure we are NOT running on Edge (we want Node + full Stripe SDK)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
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

/**
 * Billing Portal route (POST)
 *
 * - Requires logged-in session
 * - Ensures Stripe customer exists (and is valid in this Stripe mode)
 * - Creates a Stripe Billing Portal session
 * - Returns { url } for frontend redirect
 */
export async function POST() {
  const rid = requestId();

  const appUrl = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").trim();
  if (!appUrl) {
    return NextResponse.json(
      {
        error: "Missing APP_URL (or NEXTAUTH_URL) env var",
        hint:
          "Set APP_URL=https://vps-sentry.tokentap.ca in /etc/vps-sentry-web.env (systemd EnvironmentFile).",
        requestId: rid,
      },
      { status: 500 }
    );
  }

  // Stripe is lazy-initialized, but we can give a clean error message up front.
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    return NextResponse.json(
      {
        error: "Stripe is not configured",
        hint: "Missing STRIPE_SECRET_KEY in /etc/vps-sentry-web.env (systemd EnvironmentFile).",
        requestId: rid,
      },
      { status: 500 }
    );
  }

  const stripePortalHint =
    "In Stripe (LIVE): Billing → Customer portal → enable/configure the portal. " +
    "If portal isn’t configured, billingPortal.sessions.create can fail.";

  try {
    // 1) Confirm user is logged in
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.trim();
    if (!email) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          hint: "No session email found. Are you logged in via NextAuth?",
          requestId: rid,
        },
        { status: 401 }
      );
    }

    // 2) Load minimal user record
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, stripeCustomerId: true },
    });

    if (!user) {
      return NextResponse.json(
        {
          error: "User not found",
          hint:
            "Logged-in email doesn't exist in Prisma User table. Did the NextAuth user record get created?",
          email,
          requestId: rid,
        },
        { status: 404 }
      );
    }

    // 3) Ensure Stripe customer exists (and is valid in current mode)
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

    // 4) Create Stripe Billing Portal session
    const base = appUrl.replace(/\/$/, "");
    const returnUrl = `${base}/billing`;

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    // 5) Return portal URL
    return NextResponse.json({
      url: portal.url,
      meta: { requestId: rid, userId: user.id, customerId, returnUrl },
    });
  } catch (err: any) {
    const stripeMessage = err?.message ? String(err.message) : null;
    const stripeType = err?.type ? String(err.type) : null;
    const stripeCode = err?.code ? String(err.code) : null;
    const stripeStatusCode = typeof err?.statusCode === "number" ? err.statusCode : null;

    let hint = "Check server logs for details.";
    const msg = stripeMessage?.toLowerCase() || "";

    if (msg.includes("no such customer") || stripeCode === "resource_missing") {
      hint =
        "Stripe says the customer does not exist in this mode/account. " +
        "This route auto-heals by clearing stripeCustomerId and recreating it — retry once.";
    } else if (msg.includes("api key") || msg.includes("invalid api key")) {
      hint =
        "Stripe API key looks invalid/missing. Verify STRIPE_SECRET_KEY is the LIVE key and loaded into the running process.";
    } else if (msg.includes("billing portal") || msg.includes("portal")) {
      hint = stripePortalHint;
    }

    return NextResponse.json(
      {
        error: "Failed to create billing portal session",
        requestId: rid,
        stripe: {
          type: stripeType,
          code: stripeCode,
          statusCode: stripeStatusCode,
          message: stripeMessage,
        },
        hint,
      },
      { status: 500 }
    );
  }
}

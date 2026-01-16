// src/lib/stripe.ts
import Stripe from "stripe";

/**
 * ✅ Build-safe Stripe client for Next.js (App Router)
 *
 * Why:
 * - Next.js can evaluate server modules during `next build` (route data collection).
 * - If Stripe is constructed at import-time and STRIPE_SECRET_KEY isn't present
 *   (because you correctly keep secrets only in /etc/vps-sentry-web.env via systemd),
 *   the build can fail.
 *
 * What this module does:
 * - Lazy-initializes Stripe only when you actually use it at runtime
 * - Provides a clear error if STRIPE_SECRET_KEY is missing
 * - Keeps a cached singleton instance so we don’t re-init per request
 *
 * IMPORTANT:
 * - We intentionally DO NOT pin `apiVersion` here.
 *   Your installed stripe package types currently expect a specific literal
 *   (e.g. "2025-12-15.clover"). If we pin a different value, TypeScript fails the build.
 * - Let Stripe default to your account’s configured API version for now.
 */

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();

  if (!key) {
    throw new Error(
      "Stripe is not configured: missing STRIPE_SECRET_KEY. " +
        "Set it in /etc/vps-sentry-web.env (systemd EnvironmentFile) and restart vps-sentry-web.service."
    );
  }

  if (_stripe) return _stripe;

  _stripe = new Stripe(key, {
    // Do NOT set apiVersion here (avoids TS literal mismatch).
  });

  return _stripe;
}

/**
 * Backwards-compatible export for existing imports:
 *   import { stripe } from "@/lib/stripe";
 *
 * This Proxy delays Stripe creation until first property access.
 */
export const stripe = new Proxy(
  {},
  {
    get(_target, prop) {
      const s = getStripe() as any;
      return s[prop];
    },
  }
) as unknown as Stripe;

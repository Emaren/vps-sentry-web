"use client";
// /var/www/vps-sentry-web/src/app/billing/ui/BillingActions.tsx

import Link from "next/link";
import { useState } from "react";

type Plan = "BASIC" | "PRO";
type Mode = "upgrade" | "portal";

export default function BillingActions({
  defaultPlan,
  mode = "upgrade",
}: {
  defaultPlan?: Plan;
  mode?: Mode;
}) {
  const [loading, setLoading] = useState<"checkout" | "portal" | "cancel" | null>(null);

  async function startCheckout(plan: Plan) {
    setLoading("checkout");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data?.error || "Checkout failed");
      if (!data?.url) throw new Error("Checkout missing url");
      window.location.href = data.url;
    } catch (e: any) {
      alert(e?.message || "Checkout failed");
    } finally {
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data?.error || "Portal failed");
      if (!data?.url) throw new Error("Portal missing url");
      window.location.href = data.url;
    } catch (e: any) {
      alert(e?.message || "Portal failed");
    } finally {
      setLoading(null);
    }
  }

  async function cancelSubscription() {
    if (!confirm("Cancel subscription now?")) return;
    setLoading("cancel");
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data?.error || "Cancel failed");
      alert("✅ Cancellation requested. Check status in a moment.");
      window.location.reload();
    } catch (e: any) {
      alert(e?.message || "Cancel failed");
    } finally {
      setLoading(null);
    }
  }

  if (mode === "portal") {
    return (
      <div className="flex flex-wrap gap-3">
        <Link
          href="/dashboard"
          className="rounded-md border px-4 py-2 text-sm hover:bg-black/5"
        >
          Dashboard
        </Link>

        <button
          onClick={openPortal}
          disabled={loading !== null}
          className="rounded-md border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
        >
          {loading === "portal" ? "Opening…" : "Manage subscription"}
        </button>

        <button
          onClick={cancelSubscription}
          disabled={loading !== null}
          className="rounded-md border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
        >
          {loading === "cancel" ? "Cancelling…" : "Cancel subscription"}
        </button>
      </div>
    );
  }

  const plan = defaultPlan;

  return (
    <div className="flex flex-wrap gap-3">
      {plan ? (
        <button
          onClick={() => startCheckout(plan)}
          disabled={loading !== null}
          className="rounded-md border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
        >
          {loading === "checkout" ? "Redirecting…" : `Upgrade to ${plan}`}
        </button>
      ) : null}
    </div>
  );
}

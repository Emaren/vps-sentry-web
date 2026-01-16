"use client";

import { useState } from "react";

type Plan = "PRO" | "ELITE";

export default function BillingActions({ defaultPlan }: { defaultPlan?: Plan }) {
  const [loading, setLoading] = useState<"checkout" | "portal" | null>(null);

  async function startCheckout(plan: Plan) {
    setLoading("checkout");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Checkout failed");
      window.location.href = data.url;
    } catch (e: any) {
      alert(e.message || "Checkout failed");
    } finally {
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Portal failed");
      window.location.href = data.url;
    } catch (e: any) {
      alert(e.message || "Portal failed");
    } finally {
      setLoading(null);
    }
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
      ) : (
        <>
          <button
            onClick={() => startCheckout("PRO")}
            disabled={loading !== null}
            className="rounded-md border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
          >
            {loading === "checkout" ? "Redirecting…" : "Upgrade to PRO"}
          </button>
          <button
            onClick={() => startCheckout("ELITE")}
            disabled={loading !== null}
            className="rounded-md border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
          >
            {loading === "checkout" ? "Redirecting…" : "Upgrade to ELITE"}
          </button>
        </>
      )}

      <button
        onClick={openPortal}
        disabled={loading !== null}
        className="rounded-md border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
      >
        {loading === "portal" ? "Opening…" : "Manage subscription"}
      </button>
    </div>
  );
}

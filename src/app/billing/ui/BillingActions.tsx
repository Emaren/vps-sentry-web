// /var/www/vps-sentry-web/src/app/billing/ui/BillingActions.tsx
"use client";

import Link from "next/link";
import { useState } from "react";

type Plan = "BASIC" | "PRO";
type Mode = "upgrade" | "portal";
type NoticeTone = "info" | "ok" | "bad";
type Notice = { tone: NoticeTone; title: string; detail: string };

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function BillingActions({
  defaultPlan,
  mode = "upgrade",
  canManageBilling = true,
}: {
  defaultPlan?: Plan;
  mode?: Mode;
  canManageBilling?: boolean;
}) {
  const [loading, setLoading] = useState<"checkout" | "portal" | "cancel" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const blocked = !canManageBilling;

  async function startCheckout(plan: Plan) {
    setConfirmCancel(false);
    setLoading("checkout");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Preparing secure checkout.",
    });
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data?.error || "Checkout failed");
      if (!data?.url) throw new Error("Checkout missing url");
      setNotice({
        tone: "ok",
        title: "Redirecting...",
        detail: "Opening checkout in Stripe.",
      });
      window.location.href = data.url;
    } catch (e: unknown) {
      setNotice({
        tone: "bad",
        title: "Checkout failed",
        detail: errorMessage(e, "Checkout failed"),
      });
    } finally {
      setLoading(null);
    }
  }

  async function openPortal() {
    setConfirmCancel(false);
    setLoading("portal");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Opening Stripe billing portal.",
    });
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data?.error || "Portal failed");
      if (!data?.url) throw new Error("Portal missing url");
      setNotice({
        tone: "ok",
        title: "Redirecting...",
        detail: "Opening billing portal.",
      });
      window.location.href = data.url;
    } catch (e: unknown) {
      setNotice({
        tone: "bad",
        title: "Portal failed",
        detail: errorMessage(e, "Portal failed"),
      });
    } finally {
      setLoading(null);
    }
  }

  function requestCancelConfirm() {
    if (blocked || loading !== null) return;
    if (confirmCancel) {
      void cancelSubscription();
      return;
    }
    setConfirmCancel(true);
    setNotice({
      tone: "info",
      title: "Confirm cancellation",
      detail: "Click “Confirm cancel” once more to cancel now.",
    });
  }

  async function cancelSubscription() {
    setConfirmCancel(false);
    setLoading("cancel");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Requesting cancellation now.",
    });
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data?.error || "Cancel failed");
      setNotice({
        tone: "ok",
        title: "Cancellation requested",
        detail: "Subscription status is refreshing.",
      });
      window.location.reload();
    } catch (e: unknown) {
      setNotice({
        tone: "bad",
        title: "Cancel failed",
        detail: errorMessage(e, "Cancel failed"),
      });
    } finally {
      setLoading(null);
    }
  }

  const noticeClasses: Record<NoticeTone, string> = {
    info: "border-blue-400/35 bg-blue-500/10 text-[var(--site-fg)]",
    ok: "border-emerald-400/35 bg-emerald-500/10 text-[var(--site-fg)]",
    bad: "border-red-400/35 bg-red-500/12 text-[var(--site-fg)]",
  };

  if (mode === "portal") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-md border px-4 py-2 text-sm hover:bg-black/5"
          >
            Dashboard
          </Link>

          <button
            onClick={openPortal}
            disabled={loading !== null || blocked}
            className="rounded-md border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
          >
            {blocked ? "Owner role required" : loading === "portal" ? "Working..." : "Manage subscription"}
          </button>

          <button
            onClick={requestCancelConfirm}
            disabled={loading !== null || blocked}
            className="rounded-md border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
          >
            {blocked
              ? "Owner role required"
              : loading === "cancel"
              ? "Working..."
              : confirmCancel
              ? "Confirm cancel"
              : "Cancel subscription"}
          </button>
        </div>
        {notice ? (
          <div
            role="status"
            aria-live="polite"
            className={`rounded-md border px-3 py-2 text-sm ${noticeClasses[notice.tone]}`}
          >
            <div className="font-semibold">{notice.title}</div>
            <div className="mt-1 opacity-90">{notice.detail}</div>
          </div>
        ) : null}
      </div>
    );
  }

  const plan = defaultPlan;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {plan ? (
          <button
            onClick={() => startCheckout(plan)}
            disabled={loading !== null || blocked}
            className="rounded-md border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-50"
          >
            {blocked ? "Owner role required" : loading === "checkout" ? "Working..." : `Upgrade to ${plan}`}
          </button>
        ) : null}
      </div>
      {notice ? (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-md border px-3 py-2 text-sm ${noticeClasses[notice.tone]}`}
        >
          <div className="font-semibold">{notice.title}</div>
          <div className="mt-1 opacity-90">{notice.detail}</div>
        </div>
      ) : null}
    </div>
  );
}

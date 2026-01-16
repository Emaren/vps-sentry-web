import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ---------- Admin gate ----------
function isAdminEmail(email?: string | null) {
  // Keep this dumb + explicit for MVP. Later: move to DB role, allowlist, etc.
  return (email ?? "").toLowerCase() === "tonyblumdev@gmail.com";
}

function fmtDate(d?: Date | null) {
  if (!d) return "-";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    // worst-case fallback
    return d instanceof Date ? d.toISOString() : String(d);
  }
}

function badge(text: string, tone: "ok" | "warn" | "bad" | "neutral" = "neutral") {
  const bg =
    tone === "ok"
      ? "rgba(34,197,94,0.12)"
      : tone === "warn"
      ? "rgba(245,158,11,0.12)"
      : tone === "bad"
      ? "rgba(239,68,68,0.12)"
      : "rgba(255,255,255,0.04)";

  const border =
    tone === "ok"
      ? "rgba(34,197,94,0.35)"
      : tone === "warn"
      ? "rgba(245,158,11,0.35)"
      : tone === "bad"
      ? "rgba(239,68,68,0.35)"
      : "rgba(255,255,255,0.10)";

  const color =
    tone === "ok"
      ? "#86efac"
      : tone === "warn"
      ? "#fcd34d"
      : tone === "bad"
      ? "#fca5a5"
      : "#d0d0d0";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontSize: 12,
        lineHeight: "16px",
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      {text}
    </span>
  );
}

/**
 * classifyUser()
 *
 * Given the app’s billing-ish fields from User, produce:
 * - a normalized plan string
 * - booleans for stripe linkage (customer/sub)
 * - a simple “active” detector from subscriptionStatus
 * - flags (badges) that show what’s missing / weird / healthy
 * - a suspicious bool that highlights mismatch states (webhook sync issues, partial Stripe link, etc.)
 */
function classifyUser(u: {
  plan: any;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  currentPeriodEnd: Date | null;
}) {
  const plan = String(u.plan ?? "UNKNOWN").toUpperCase();

  const hasCustomer = Boolean(u.stripeCustomerId);
  const hasSub = Boolean(u.subscriptionId);
  const status = (u.subscriptionStatus ?? "").toLowerCase();

  const isActive = status === "active" || status === "trialing";
  const isCanceled = status === "canceled" || status === "incomplete_expired";
  const isIncomplete = status === "incomplete" || status === "past_due" || status === "unpaid";

  // Useful “sanity flags” for admin triage
  const flags: Array<{ text: string; tone: "ok" | "warn" | "bad" | "neutral" }> = [];

  // Stripe linkage flags
  if (hasCustomer) flags.push({ text: "customer", tone: "ok" });
  else flags.push({ text: "no-customer", tone: "warn" });

  if (hasSub) flags.push({ text: "sub", tone: "ok" });
  else flags.push({ text: "no-sub", tone: "neutral" });

  // Subscription status flag
  if (!u.subscriptionStatus) flags.push({ text: "no-status", tone: "neutral" });
  else if (isActive) flags.push({ text: u.subscriptionStatus, tone: "ok" });
  else if (isIncomplete) flags.push({ text: u.subscriptionStatus, tone: "warn" });
  else if (isCanceled) flags.push({ text: u.subscriptionStatus, tone: "bad" });
  else flags.push({ text: u.subscriptionStatus, tone: "neutral" });

  // Period end flag (relative, good for eyeballing)
  if (u.currentPeriodEnd) {
    const ms = u.currentPeriodEnd.getTime() - Date.now();
    const days = Math.round(ms / (1000 * 60 * 60 * 24));
    flags.push({
      text: `periodEnd ${days >= 0 ? `in ${days}d` : `${Math.abs(days)}d ago`}`,
      tone: days >= 0 ? "ok" : "warn",
    });
  } else {
    flags.push({ text: "no-periodEnd", tone: "neutral" });
  }

  /**
   * Suspicious heuristics (MVP)
   *
   * These are “high signal” inconsistencies that normally mean:
   * - webhook didn’t run
   * - you used the wrong webhook secret / endpoint
   * - user row didn’t get updated after Stripe subscription change
   *
   * Examples:
   * - plan != FREE but subscription status not active/trialing
   * - plan == FREE but subscription is active/trialing
   * - subscriptionId exists without a customerId (shouldn’t happen)
   * - active status without a subscriptionId recorded
   */
  const suspicious =
    (plan !== "FREE" && !isActive) ||
    (plan === "FREE" && isActive) ||
    (hasSub && !hasCustomer) ||
    (isActive && !hasSub);

  return { plan, hasCustomer, hasSub, isActive, suspicious, flags };
}

export default async function AdminPage() {
  // ---------- 1) Auth ----------
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  // If not logged in OR not allowlisted admin => bounce to /login
  // (You can change this to redirect("/") if your /login is not the entry point.)
  if (!session?.user || !isAdminEmail(email)) {
    redirect("/login");
  }

  // ---------- 2) Data pull ----------
  // Your Prisma schema apparently doesn't have createdAt on User, so ordering by id is a pragmatic MVP choice.
  // (CUIDs are not guaranteed chronological, but usually "good enough" for "recent-ish first".)
  const users = await prisma.user.findMany({
    orderBy: { id: "desc" },
    select: {
      id: true,
      name: true,
      email: true,

      // Billing-ish fields you added to User
      plan: true,
      hostLimit: true,
      stripeCustomerId: true,
      subscriptionStatus: true,
      subscriptionId: true,
      currentPeriodEnd: true,
    },
  });

  // ---------- 3) Quick summary numbers (helps you “see” the system at a glance) ----------
  const totals = users.reduce(
    (acc, u) => {
      const info = classifyUser(u);
      acc.total += 1;
      if (info.isActive) acc.active += 1;
      if (info.plan === "PRO") acc.pro += 1;
      if (info.plan === "ELITE") acc.elite += 1;
      if (info.plan === "FREE") acc.free += 1;
      if (info.suspicious) acc.suspicious += 1;
      if (u.stripeCustomerId) acc.customers += 1;
      if (u.subscriptionId) acc.subs += 1;
      return acc;
    },
    { total: 0, active: 0, free: 0, pro: 0, elite: 0, customers: 0, subs: 0, suspicious: 0 }
  );

  // ---------- 4) UI ----------
  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Admin</h1>
          <p style={{ opacity: 0.75, marginTop: 6, marginBottom: 0 }}>
            Logged in as <b>{email}</b>
          </p>
          <p style={{ opacity: 0.7, marginTop: 10, marginBottom: 0, maxWidth: 900 }}>
            This page is your “truth panel”: it shows who exists in your database, what plan they’re on, whether Stripe is
            linked, and whether the subscription state looks sane. If something breaks, this tells you where.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <Link
            href="/dashboard"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              textDecoration: "none",
              color: "#eaeaea",
              fontSize: 14,
            }}
          >
            Back to Dashboard
          </Link>
          <Link
            href="/billing"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              textDecoration: "none",
              color: "#eaeaea",
              fontSize: 14,
            }}
          >
            Billing Page
          </Link>
        </div>
      </header>

      {/* Summary row */}
      <section
        style={{
          marginTop: 18,
          padding: 14,
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 12,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {badge(`Users: ${totals.total}`, "neutral")}
          {badge(`Active subs: ${totals.active}`, totals.active > 0 ? "ok" : "neutral")}
          {badge(`FREE: ${totals.free}`, "neutral")}
          {badge(`PRO: ${totals.pro}`, totals.pro > 0 ? "ok" : "neutral")}
          {badge(`ELITE: ${totals.elite}`, totals.elite > 0 ? "ok" : "neutral")}
          {badge(`Stripe customers: ${totals.customers}`, totals.customers > 0 ? "ok" : "neutral")}
          {badge(`Stripe subs: ${totals.subs}`, totals.subs > 0 ? "ok" : "neutral")}
          {badge(`Suspicious: ${totals.suspicious}`, totals.suspicious > 0 ? "warn" : "ok")}
        </div>

        <p style={{ opacity: 0.7, marginTop: 10, marginBottom: 0, fontSize: 13 }}>
          “Suspicious” usually means <b>plan</b> and <b>subscriptionStatus</b> don’t match (e.g. plan=PRO but status isn’t
          active), or Stripe linkage is incomplete (e.g. subscriptionId exists but stripeCustomerId missing).
        </p>
      </section>

      {/* Users table */}
      <section
        style={{
          marginTop: 18,
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 12,
          overflow: "hidden",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 2.2fr 0.9fr 0.8fr 1.4fr 2.3fr",
            padding: "12px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.10)",
            fontWeight: 700,
            opacity: 0.92,
            background: "rgba(255,255,255,0.04)",
          }}
        >
          <div>Name</div>
          <div>Email</div>
          <div>Plan</div>
          <div>Hosts</div>
          <div>Period End</div>
          <div>Stripe / Status</div>
        </div>

        {/* Rows */}
        {users.map((u) => {
          const info = classifyUser(u);
          const rowBg = info.suspicious ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.00)";

          return (
            <div
              key={u.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 2.2fr 0.9fr 0.8fr 1.4fr 2.3fr",
                padding: "12px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                background: rowBg,
              }}
            >
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {u.name ?? "-"}
                {info.suspicious && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.8 }}>⚠️</span>}
              </div>

              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {u.email ?? "-"}
              </div>

              <div>{badge(info.plan, info.plan === "FREE" ? "neutral" : "ok")}</div>

              <div style={{ opacity: 0.9 }}>{u.hostLimit ?? "-"}</div>

              <div style={{ opacity: 0.85 }}>{fmtDate(u.currentPeriodEnd)}</div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {info.flags.map((f, idx) => (
                  <span key={`${u.id}-${idx}`}>{badge(f.text, f.tone)}</span>
                ))}
              </div>
            </div>
          );
        })}

        {users.length === 0 && <div style={{ padding: 14, opacity: 0.7 }}>No users yet.</div>}
      </section>

      {/* Footer notes */}
      <footer style={{ marginTop: 16, opacity: 0.7, fontSize: 13, lineHeight: "18px" }}>
        <p style={{ margin: 0 }}>Notes:</p>
        <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18 }}>
          <li>
            Admin access is currently hardcoded to <b>tonyblumdev@gmail.com</b>. Later you can move this to a DB role or an
            allowlist env var.
          </li>
          <li>
            Ordering is by <b>id desc</b> because your schema doesn’t have <code>createdAt</code> on <code>User</code>. If
            you add <code>createdAt</code>, switch back to that.
          </li>
          <li>
            Stripe “truth” is: <b>customerId</b> must exist to open the Billing Portal; <b>subscriptionStatus</b> and{" "}
            <b>currentPeriodEnd</b> should be updated by your webhook.
          </li>
        </ul>
      </footer>
    </main>
  );
}

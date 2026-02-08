import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess, requireOwnerAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import AdminOpsPanel from "@/app/admin/AdminOpsPanel";
import { INCIDENT_WORKFLOWS } from "@/lib/ops/workflows";
import { getRemediationQueueSnapshot } from "@/lib/remediate/queue";
import { getObservabilitySnapshot } from "@/lib/observability";
import { buildSloSnapshot } from "@/lib/slo";
import { getIncidentRunDetail, listIncidentRuns } from "@/lib/ops/incident-engine";
import {
  RBAC_ROLE_ORDER,
  normalizeAppRole,
  roleLabel,
  type AppRole,
} from "@/lib/rbac-policy";

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
      ? "var(--dash-sev-ok-bg)"
      : tone === "warn"
      ? "var(--dash-sev-high-bg)"
      : tone === "bad"
      ? "var(--dash-sev-critical-bg)"
      : "color-mix(in srgb, var(--dash-card-bg) 80%, transparent 20%)";

  const border =
    tone === "ok"
      ? "var(--dash-sev-ok-border)"
      : tone === "warn"
      ? "var(--dash-sev-high-border)"
      : tone === "bad"
      ? "var(--dash-sev-critical-border)"
      : "var(--dash-soft-border)";

  const color =
    tone === "ok"
      ? "var(--dash-sev-ok-text)"
      : tone === "warn"
      ? "var(--dash-sev-high-text)"
      : tone === "bad"
      ? "var(--dash-sev-critical-text)"
      : "var(--dash-meta)";

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

function roleTone(role: AppRole): "ok" | "warn" | "bad" | "neutral" {
  if (role === "owner" || role === "admin") return "ok";
  if (role === "ops") return "warn";
  return "neutral";
}

function toAdminPlanLabel(plan: string): "FREE" | "BASIC" | "PRO" | "UNKNOWN" {
  const normalized = String(plan ?? "UNKNOWN").toUpperCase();
  if (normalized === "FREE") return "FREE";
  if (normalized === "ELITE") return "PRO";
  if (normalized === "PRO" || normalized === "BASIC") return "BASIC";
  return "UNKNOWN";
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
  plan: unknown;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  currentPeriodEnd: Date | null;
}) {
  const rawPlan = String(u.plan ?? "UNKNOWN").toUpperCase();
  const plan = toAdminPlanLabel(rawPlan);

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
  async function updateUserRoleAction(formData: FormData) {
    "use server";

    const access = await requireOwnerAccess();
    if (!access.ok) {
      await writeAuditLog({
        action: "admin.role.update.denied",
        detail: `status=${access.status} email=${access.email ?? "unknown"}`,
        meta: {
          route: "/admin",
          status: access.status,
          requiredRole: "owner",
        },
      });
      return;
    }

    const targetUserIdRaw = formData.get("targetUserId");
    const targetRoleRaw = formData.get("targetRole");
    const targetUserId = typeof targetUserIdRaw === "string" ? targetUserIdRaw.trim() : "";
    const targetRole = normalizeAppRole(targetRoleRaw);
    if (!targetUserId || !targetRole) return;

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true },
    });
    if (!targetUser) return;

    const currentRole = normalizeAppRole(targetUser.role) ?? "viewer";

    if (targetUser.id === access.identity.userId && targetRole !== "owner") {
      await writeAuditLog({
        userId: access.identity.userId,
        action: "admin.role.update.denied",
        detail: "Owner attempted to remove own owner role",
        meta: {
          route: "/admin",
          targetUserId,
          targetRole,
        },
      });
      return;
    }

    if (currentRole === "owner" && targetRole !== "owner") {
      const ownerCount = await prisma.user.count({ where: { role: "owner" } });
      if (ownerCount <= 1) {
        await writeAuditLog({
          userId: access.identity.userId,
          action: "admin.role.update.denied",
          detail: "Refused to demote the last owner",
          meta: {
            route: "/admin",
            targetUserId,
            targetRole,
            ownerCount,
          },
        });
        return;
      }
    }

    if (currentRole === targetRole) return;

    await prisma.user.update({
      where: { id: targetUser.id },
      data: { role: targetRole },
    });

    await writeAuditLog({
      userId: access.identity.userId,
      action: "admin.role.update",
      detail: `Changed ${targetUser.email ?? targetUser.id} role ${currentRole} -> ${targetRole}`,
      meta: {
        route: "/admin",
        targetUserId: targetUser.id,
        targetEmail: targetUser.email ?? null,
        fromRole: currentRole,
        toRole: targetRole,
      },
    });

    revalidatePath("/admin");
  }

  // ---------- 1) Auth ----------
  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      action: "admin.page.denied",
      detail: `status=${access.status} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/admin",
        status: access.status,
        email: access.email ?? null,
      },
    });
    redirect("/login");
  }
  const email = access.identity.email;
  const canManageRoles = access.identity.role === "owner";

  await writeAuditLog({
    action: "admin.page.view",
    userId: access.identity.userId,
    detail: `Admin page viewed by ${email}`,
    meta: {
      route: "/admin",
    },
  });

  // ---------- 2) Data pull ----------
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,

      // Billing-ish fields you added to User
      role: true,
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
      const role = normalizeAppRole(u.role) ?? "viewer";
      acc.total += 1;
      if (info.isActive) acc.active += 1;
      if (info.plan === "BASIC") acc.basic += 1;
      if (info.plan === "PRO") acc.pro += 1;
      if (info.plan === "FREE") acc.free += 1;
      if (info.suspicious) acc.suspicious += 1;
      if (u.stripeCustomerId) acc.customers += 1;
      if (u.subscriptionId) acc.subs += 1;
      if (role === "owner") acc.owners += 1;
      if (role === "admin") acc.admins += 1;
      if (role === "ops") acc.ops += 1;
      if (role === "viewer") acc.viewers += 1;
      return acc;
    },
    {
      total: 0,
      active: 0,
      free: 0,
      basic: 0,
      pro: 0,
      customers: 0,
      subs: 0,
      suspicious: 0,
      owners: 0,
      admins: 0,
      ops: 0,
      viewers: 0,
    }
  );

  const recentOpsRaw = await prisma.auditLog.findMany({
    where: {
      OR: [
        { action: { startsWith: "ops." } },
        { action: { startsWith: "remediate." } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      action: true,
      detail: true,
      createdAt: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  const recentOps = recentOpsRaw.map((entry) => ({
    id: entry.id,
    action: entry.action,
    detail: entry.detail,
    createdAtIso: fmtDate(entry.createdAt),
    userEmail: entry.user?.email ?? null,
  }));

  const queueSnapshot = await getRemediationQueueSnapshot({ limit: 30 });
  const observabilitySnapshot = getObservabilitySnapshot({
    logsLimit: 80,
    tracesLimit: 80,
    alertsLimit: 80,
    countersLimit: 350,
    timingsLimit: 350,
  });
  const sloSnapshot = await buildSloSnapshot();
  const incidentSnapshot = await listIncidentRuns({
    limit: 30,
    state: "active",
  });
  const initialIncidentId = incidentSnapshot.incidents[0]?.id ?? null;
  const initialIncidentDetail = initialIncidentId
    ? await getIncidentRunDetail(initialIncidentId, { timelineLimit: 120 })
    : null;
  const incidentAssignees = users
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      role: normalizeAppRole(u.role) ?? "viewer",
    }))
    .filter(
      (
        u
      ): u is { id: string; email: string; name: string | null; role: AppRole } =>
        Boolean(u.email) &&
        (u.role === "owner" || u.role === "admin" || u.role === "ops")
    );

  // ---------- 4) UI ----------
  return (
    <main className="dashboard-shell dashboard-main" style={{ maxWidth: 1200 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Admin</h1>
          <p style={{ color: "var(--dash-meta)", marginTop: 6, marginBottom: 0 }}>
            Logged in as <b>{email}</b> · role <b>{roleLabel(access.identity.role)}</b>
          </p>
          <p style={{ color: "var(--dash-meta)", marginTop: 10, marginBottom: 0, maxWidth: 900 }}>
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
              border: "1px solid var(--dash-btn-border)",
              background: "var(--dash-btn-bg)",
              textDecoration: "none",
              color: "var(--dash-fg)",
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
              border: "1px solid var(--dash-btn-border)",
              background: "var(--dash-btn-bg)",
              textDecoration: "none",
              color: "var(--dash-fg)",
              fontSize: 14,
            }}
          >
            Billing Page
          </Link>
        </div>
      </header>

      <section
        style={{
          marginTop: 18,
          padding: 14,
          border: "1px solid var(--dash-card-border)",
          borderRadius: 12,
          background: "var(--dash-card-bg)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>Noob Coach v2</h2>
        <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 13 }}>
          Fast admin order-of-operations: 1) resolve suspicious users, 2) verify queue/DLQ is clean,
          3) confirm observability + SLO are healthy, 4) review recent ops timeline for drift.
        </div>
      </section>

      {/* Summary row */}
      <section
        style={{
          marginTop: 18,
          padding: 14,
          border: "1px solid var(--dash-card-border)",
          borderRadius: 12,
          background: "var(--dash-card-bg)",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {badge(`Users: ${totals.total}`, "neutral")}
          {badge(`Owners: ${totals.owners}`, totals.owners > 0 ? "ok" : "warn")}
          {badge(`Admins: ${totals.admins}`, totals.admins > 0 ? "ok" : "neutral")}
          {badge(`Ops: ${totals.ops}`, totals.ops > 0 ? "ok" : "neutral")}
          {badge(`Viewers: ${totals.viewers}`, "neutral")}
          {badge(`Active subs: ${totals.active}`, totals.active > 0 ? "ok" : "neutral")}
          {badge(`FREE: ${totals.free}`, "neutral")}
          {badge(`BASIC: ${totals.basic}`, totals.basic > 0 ? "ok" : "neutral")}
          {badge(`PRO: ${totals.pro}`, totals.pro > 0 ? "ok" : "neutral")}
          {badge(`Stripe customers: ${totals.customers}`, totals.customers > 0 ? "ok" : "neutral")}
          {badge(`Stripe subs: ${totals.subs}`, totals.subs > 0 ? "ok" : "neutral")}
          {badge(`Suspicious: ${totals.suspicious}`, totals.suspicious > 0 ? "warn" : "ok")}
        </div>

        <p style={{ color: "var(--dash-meta)", marginTop: 10, marginBottom: 0, fontSize: 13 }}>
          “Suspicious” usually means <b>plan</b> and <b>subscriptionStatus</b> don’t match (e.g. plan=PRO but status isn’t
          active), or Stripe linkage is incomplete (e.g. subscriptionId exists but stripeCustomerId missing).
        </p>
      </section>

      {/* Users table */}
      <section
        style={{
          marginTop: 18,
          border: "1px solid var(--dash-card-border)",
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--dash-card-bg)",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 2fr 1.4fr 0.9fr 0.8fr 1.3fr 2.2fr",
            padding: "12px 14px",
            borderBottom: "1px solid var(--dash-soft-border)",
            fontWeight: 700,
            color: "var(--dash-muted)",
            background: "color-mix(in srgb, var(--dash-card-bg) 90%, transparent 10%)",
          }}
        >
          <div>Name</div>
          <div>Email</div>
          <div>Role</div>
          <div>Plan</div>
          <div>Hosts</div>
          <div>Period End</div>
          <div>Stripe / Status</div>
        </div>

        {/* Rows */}
        {users.map((u) => {
          const info = classifyUser(u);
          const userRole = normalizeAppRole(u.role) ?? "viewer";
          const rowBg = info.suspicious
            ? "color-mix(in srgb, var(--dash-sev-critical-bg) 85%, transparent 15%)"
            : "transparent";

          return (
            <div
              key={u.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 2fr 1.4fr 0.9fr 0.8fr 1.3fr 2.2fr",
                padding: "12px 14px",
                borderBottom: "1px solid var(--dash-soft-border)",
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

              <div style={{ display: "grid", gap: 6 }}>
                <div>{badge(roleLabel(userRole), roleTone(userRole))}</div>
                {canManageRoles ? (
                  <form action={updateUserRoleAction} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input type="hidden" name="targetUserId" value={u.id} />
                    <select
                      name="targetRole"
                      defaultValue={userRole}
                      style={{
                        background: "var(--dash-btn-bg)",
                        color: "var(--dash-fg)",
                        border: "1px solid var(--dash-btn-border)",
                        borderRadius: 8,
                        padding: "4px 6px",
                        fontSize: 12,
                      }}
                    >
                      {RBAC_ROLE_ORDER
                        .slice()
                        .reverse()
                        .map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                    </select>
                    <button
                      type="submit"
                      style={{
                        background: "var(--dash-btn-bg)",
                        color: "var(--dash-fg)",
                        border: "1px solid var(--dash-btn-border)",
                        borderRadius: 8,
                        padding: "4px 8px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Save
                    </button>
                  </form>
                ) : null}
              </div>

              <div>{badge(info.plan, info.plan === "FREE" ? "neutral" : "ok")}</div>

              <div style={{ color: "var(--dash-muted)" }}>{u.hostLimit ?? "-"}</div>

              <div style={{ color: "var(--dash-meta)" }}>{fmtDate(u.currentPeriodEnd)}</div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {info.flags.map((f, idx) => (
                  <span key={`${u.id}-${idx}`}>{badge(f.text, f.tone)}</span>
                ))}
              </div>
            </div>
          );
        })}

        {users.length === 0 && <div style={{ padding: 14, color: "var(--dash-meta)" }}>No users yet.</div>}
      </section>

      <AdminOpsPanel
        workflows={INCIDENT_WORKFLOWS}
        recentOps={recentOps}
        queueSnapshot={queueSnapshot}
        observabilitySnapshot={observabilitySnapshot}
        sloSnapshot={sloSnapshot}
        incidentSnapshot={incidentSnapshot}
        initialIncidentDetail={initialIncidentDetail}
        incidentAssignees={incidentAssignees}
        currentIdentity={{
          userId: access.identity.userId,
          email: access.identity.email,
          role: access.identity.role,
        }}
      />
    </main>
  );
}

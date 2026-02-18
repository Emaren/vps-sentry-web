import { NextResponse } from "next/server";
import { requireViewerAccess } from "@/lib/rbac";
import { hasRequiredRole } from "@/lib/rbac-policy";
import { writeAuditLog } from "@/lib/audit-log";
import { ACTION_DECK_BY_ID } from "@/lib/actions/ability-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

export async function POST(req: Request) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, skipped: "build" });
  }

  const access = await requireViewerAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const abilityId = typeof body.abilityId === "string" ? body.abilityId.trim() : "";
  const ok = body.ok === true;
  const status = typeof body.status === "number" ? body.status : 0;

  if (!abilityId) {
    return NextResponse.json({ ok: false, error: "abilityId is required" }, { status: 400 });
  }

  const ability = ACTION_DECK_BY_ID.get(abilityId);
  if (!ability) {
    return NextResponse.json({ ok: false, error: "ability is not allowlisted" }, { status: 400 });
  }

  if (!hasRequiredRole(access.identity.role, ability.requiredRole)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await writeAuditLog({
    req,
    userId: access.identity.userId,
    action: "ops.actions.deck.run",
    detail: abilityId,
    meta: {
      abilityId,
      path: ability.path,
      method: ability.method,
      requiredRole: ability.requiredRole,
      ok,
      status,
      source: "actions-page",
    },
  });

  return NextResponse.json({ ok: true });
}

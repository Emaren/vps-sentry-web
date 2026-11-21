import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { readFleetProjection } from "@/lib/kingdom-os/reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated READ-ONLY Kingdom OS adapter.
 * No pass-through paths, shell commands, cleaning, keys, or financial authority.
 */
export async function GET() {
  if (process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.npm_lifecycle_event === "build") {
    return NextResponse.json({ ok: false, code: "BUILD_PHASE_NO_OBSERVATION" }, { status: 503 });
  }
  const access = await requireOpsAccess();
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN" },
      { status: access.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const fleet = await readFleetProjection();
    return NextResponse.json(
      { ok: true, fleet },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json(
      { ok: false, code: "VPSSENTRY_SOURCE_UNAVAILABLE", fleet: null },
      { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  }
}

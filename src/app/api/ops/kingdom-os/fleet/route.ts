import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import {
  STATUS_MAX_BYTES,
  STATUS_PATH,
  projectFleetStatus,
} from "@/lib/kingdom-os/fleet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated READ-ONLY Kingdom OS adapter.
 * No pass-through filesystem paths, host shell commands, scanning, key access,
 * remediation endpoints, queue writes, or financial scope.
 */
async function readOriginalStatus(): Promise<{ snapshot: unknown; sha256: string }> {
  const fh = await open(STATUS_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.uid !== 0 || st.nlink !== 1 ||
        (st.mode & 0o022) !== 0 || st.size <= 0 || st.size > STATUS_MAX_BYTES) {
      throw new Error("untrusted_source_file");
    }
    const raw = await fh.readFile();
    if (raw.length !== st.size) throw new Error("changing_source_file");
    const snapshot = JSON.parse(raw.toString("utf8")) as unknown;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new Error("invalid_source_schema");
    }
    return { snapshot, sha256: createHash("sha256").update(raw).digest("hex") };
  } finally {
    await fh.close();
  }
}

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
    const { snapshot, sha256 } = await readOriginalStatus();
    const fleet = projectFleetStatus(snapshot, sha256);
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

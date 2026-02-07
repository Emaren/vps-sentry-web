import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildRemediationPlanFromSnapshots } from "@/lib/remediate";
import { executeRemediationCommands, formatExecutionForLog } from "@/lib/remediate/runner";
import type { RemediationAction } from "@/lib/remediate/actions";

export const dynamic = "force-dynamic";
type RemediationMode = "plan" | "dry-run" | "execute";

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeMode(v: unknown): RemediationMode {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "dry-run" || t === "execute") return t;
  return "plan";
}

function resolveAction(actions: RemediationAction[], id: string): RemediationAction | null {
  if (!id) return null;
  return actions.find((a) => a.id === id) ?? null;
}

function dryRunOutput(action: RemediationAction): string {
  return [
    `mode=dry-run action=${action.id}`,
    "",
    "No commands were executed on the host.",
    "Commands that would run:",
    ...action.commands.map((c, i) => `${i + 1}. ${c}`),
    "",
    action.rollbackNotes?.length ? `Rollback notes: ${action.rollbackNotes.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function getRemediationRuns(hostId: string, limit = 15) {
  return prisma.remediationRun.findMany({
    where: { hostId },
    orderBy: { requestedAt: "desc" },
    take: Math.max(1, Math.min(limit, 40)),
    select: {
      id: true,
      state: true,
      requestedAt: true,
      startedAt: true,
      finishedAt: true,
      output: true,
      error: true,
      action: {
        select: { key: true, title: true },
      },
      requestedBy: {
        select: { email: true },
      },
    },
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const hostId = typeof body?.hostId === "string" ? body.hostId.trim() : "";
  const actionId = typeof body?.actionId === "string" ? body.actionId.trim() : "";
  const confirmPhrase = typeof body?.confirmPhrase === "string" ? body.confirmPhrase.trim() : "";
  const mode = normalizeMode(body?.mode);
  const limitRaw = Number(body?.limit ?? 40);
  const limit = Number.isFinite(limitRaw) ? Math.max(10, Math.min(limitRaw, 200)) : 40;

  if (!hostId) {
    return NextResponse.json({ ok: false, error: "hostId is required" }, { status: 400 });
  }

  const host = await prisma.host.findFirst({
    where: { id: hostId, userId: user.id },
    select: { id: true, name: true, slug: true, lastSeenAt: true, enabled: true },
  });
  if (!host) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  const snapshots = await prisma.hostSnapshot.findMany({
    where: { hostId: host.id },
    orderBy: { ts: "desc" },
    take: limit,
    select: {
      id: true,
      ts: true,
      statusJson: true,
    },
  });

  const parsed = snapshots
    .map((s) => ({ id: s.id, ts: s.ts, status: safeParse(s.statusJson) }))
    .filter((s): s is { id: string; ts: Date; status: Record<string, unknown> } => Boolean(s.status && typeof s.status === "object"));

  const plan = buildRemediationPlanFromSnapshots(parsed);
  const recentRuns = await getRemediationRuns(host.id);

  if (mode === "plan") {
    return NextResponse.json({
      ok: true,
      mode,
      host,
      snapshotsConsidered: parsed.length,
      timelineCount: plan.timelineCount,
      topCodes: plan.topCodes,
      context: plan.context,
      actions: plan.actions,
      runs: recentRuns,
    });
  }

  const action = resolveAction(plan.actions, actionId);
  if (!action) {
    return NextResponse.json(
      { ok: false, error: "Unknown actionId for this host/timeline." },
      { status: 404 }
    );
  }

  if (mode === "execute" && action.requiresConfirm && confirmPhrase !== action.confirmPhrase) {
    return NextResponse.json(
      {
        ok: false,
        error: "Confirmation phrase mismatch.",
        expected: action.confirmPhrase,
      },
      { status: 400 }
    );
  }

  const actionRow = await prisma.remediationAction.upsert({
    where: { key: action.id },
    create: {
      key: action.id,
      title: action.title,
      description: action.why,
      enabled: true,
      paramsSchemaJson: JSON.stringify({
        sourceCodes: action.sourceCodes,
        requiresConfirm: action.requiresConfirm,
      }),
    },
    update: {
      title: action.title,
      description: action.why,
      enabled: true,
      paramsSchemaJson: JSON.stringify({
        sourceCodes: action.sourceCodes,
        requiresConfirm: action.requiresConfirm,
      }),
    },
    select: { id: true, key: true },
  });

  const run = await prisma.remediationRun.create({
    data: {
      hostId: host.id,
      actionId: actionRow.id,
      requestedByUserId: user.id,
      state: mode === "dry-run" ? "succeeded" : "running",
      startedAt: mode === "dry-run" ? new Date() : new Date(),
      finishedAt: mode === "dry-run" ? new Date() : null,
      paramsJson: JSON.stringify({
        mode,
        actionId: action.id,
        sourceCodes: action.sourceCodes,
        commands: action.commands,
        rollbackNotes: action.rollbackNotes ?? [],
      }),
      output: mode === "dry-run" ? dryRunOutput(action) : null,
    },
    select: {
      id: true,
      state: true,
      requestedAt: true,
      startedAt: true,
      finishedAt: true,
      output: true,
      error: true,
    },
  });

  if (mode === "dry-run") {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        hostId: host.id,
        action: "remediate.dry_run",
        detail: `Dry-run action ${action.id}`,
      },
    });

    return NextResponse.json({
      ok: true,
      mode,
      host,
      action,
      run,
      actions: plan.actions,
      runs: await getRemediationRuns(host.id),
    });
  }

  let executionOk = false;
  let executionOutput = "";
  let executionError: string | null = null;

  try {
    const execution = await executeRemediationCommands(action.commands);
    executionOk = execution.ok;
    executionOutput = formatExecutionForLog(execution);
    if (!execution.ok) executionError = "One or more remediation commands failed.";
  } catch (err: unknown) {
    executionOk = false;
    executionError = String(err);
    executionOutput = `execution_error=${executionError}`;
  }

  const finishedRun = await prisma.remediationRun.update({
    where: { id: run.id },
    data: {
      state: executionOk ? "succeeded" : "failed",
      finishedAt: new Date(),
      output: executionOutput,
      error: executionError,
    },
    select: {
      id: true,
      state: true,
      requestedAt: true,
      startedAt: true,
      finishedAt: true,
      output: true,
      error: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      hostId: host.id,
      action: "remediate.execute",
      detail: `Execute action ${action.id} (${executionOk ? "succeeded" : "failed"})`,
      metaJson: JSON.stringify({
        runId: finishedRun.id,
        mode,
        actionId: action.id,
      }),
    },
  });

  return NextResponse.json({
    ok: executionOk,
    mode,
    host,
    action,
    run: finishedRun,
    actions: plan.actions,
    runs: await getRemediationRuns(host.id),
  });
}

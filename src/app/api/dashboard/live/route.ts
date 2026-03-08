import { readFile, statfs } from "node:fs/promises";
import os from "node:os";
import { safeRequestUrl } from "@/lib/request-url";

export const dynamic = "force-dynamic";
const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

type LivePulsePayload = {
  ts: string;
  snapshotTs: string;
  alertsCount: number;
  unexpectedPorts: number;
  openBreaches: number;
  incidentsOpen: number;
  queueQueued: number;
  queueDlq: number;
  shippingFailed24h: number;
  hostVitals: {
    source: "live" | "snapshot";
    updatedTs: string;
    cpuUsedPercent: number | null;
    cpuCapacityPercent: number;
    cpuCores: number | null;
    memoryUsedPercent: number | null;
    memoryCapacityPercent: number;
    memoryUsedMb: number | null;
    memoryTotalMb: number | null;
    diskUsedPercent: number | null;
    diskUsedBytes: number | null;
    diskTotalBytes: number | null;
    diskAvailableBytes: number | null;
  };
};

type CpuSample = {
  idle: number;
  total: number;
};

function parseInterval(v: string | null): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 5000;
  const t = Math.trunc(n);
  if (t < 2500) return 2500;
  if (t > 30000) return 30000;
  return t;
}

function toMb(bytes: number): number {
  return bytes / (1024 * 1024);
}

async function readCpuSample(): Promise<CpuSample | null> {
  try {
    const raw = await readFile("/proc/stat", "utf8");
    const first = raw.split("\n")[0] ?? "";
    if (!first.startsWith("cpu ")) return null;
    const parts = first.trim().split(/\s+/).slice(1).map((value) => Number.parseInt(value, 10));
    if (!parts.length || parts.some((value) => !Number.isFinite(value))) return null;
    const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
    const total = parts.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return null;
    return { idle, total };
  } catch {
    return null;
  }
}

function cpuPercentBetween(previous: CpuSample | null, current: CpuSample | null): number | null {
  if (!previous || !current) return null;
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return null;
  return ((totalDelta - idleDelta) / totalDelta) * 100;
}

async function readLiveHostVitals(input: {
  fallback: LivePulsePayload["hostVitals"];
  previousCpuSample: CpuSample | null;
}): Promise<{ nextCpuSample: CpuSample | null; hostVitals: LivePulsePayload["hostVitals"] }> {
  const fallback = input.fallback;
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);
  const memoryUsedPercent = totalMemBytes > 0 ? (usedMemBytes / totalMemBytes) * 100 : null;

  let diskUsedBytes: number | null = fallback.diskUsedBytes;
  let diskTotalBytes: number | null = fallback.diskTotalBytes;
  let diskAvailableBytes: number | null = fallback.diskAvailableBytes;
  let diskUsedPercent: number | null = fallback.diskUsedPercent;

  try {
    const fsStats = await statfs("/");
    const blockSize = Number(fsStats.bsize);
    const blocks = Number(fsStats.blocks);
    const availableBlocks = Number(fsStats.bavail);
    if (Number.isFinite(blockSize) && Number.isFinite(blocks) && Number.isFinite(availableBlocks)) {
      diskTotalBytes = blockSize * blocks;
      diskAvailableBytes = blockSize * availableBlocks;
      diskUsedBytes = Math.max(0, diskTotalBytes - diskAvailableBytes);
      diskUsedPercent = diskTotalBytes > 0 ? (diskUsedBytes / diskTotalBytes) * 100 : null;
    }
  } catch {
    // fall back to snapshot values
  }

  const currentCpuSample = await readCpuSample();
  const liveCpuUsedPercent = cpuPercentBetween(input.previousCpuSample, currentCpuSample);
  const hostVitals: LivePulsePayload["hostVitals"] = {
    source: liveCpuUsedPercent === null ? "snapshot" : "live",
    updatedTs: new Date().toISOString(),
    cpuUsedPercent: liveCpuUsedPercent ?? fallback.cpuUsedPercent,
    cpuCapacityPercent: 100,
    cpuCores: os.cpus()?.length ?? fallback.cpuCores,
    memoryUsedPercent,
    memoryCapacityPercent: 100,
    memoryUsedMb: toMb(usedMemBytes),
    memoryTotalMb: toMb(totalMemBytes),
    diskUsedPercent,
    diskUsedBytes,
    diskTotalBytes,
    diskAvailableBytes,
  };

  return {
    nextCpuSample: currentCpuSample,
    hostVitals,
  };
}

async function buildLivePulse(input: {
  userId: string;
  userRole: "viewer" | "ops" | "admin" | "owner";
}, deps: {
  deriveDashboard: (typeof import("@/app/dashboard/_lib/derive"))["deriveDashboard"];
  getDashboardOpsSnapshot: (typeof import("@/app/dashboard/_lib/fetch"))["getDashboardOpsSnapshot"];
  getStatusEnvelopeSafe: (typeof import("@/app/dashboard/_lib/fetch"))["getStatusEnvelopeSafe"];
}): Promise<LivePulsePayload> {
  const [env, ops] = await Promise.all([
    deps.getStatusEnvelopeSafe(),
    deps.getDashboardOpsSnapshot({
      userId: input.userId,
      userRole: input.userRole,
    }),
  ]);

  const derived = deps.deriveDashboard(env);

  return {
    ts: new Date().toISOString(),
    snapshotTs: derived.snapshotTs,
    alertsCount: derived.alertsCount,
    unexpectedPorts: derived.publicPortsCount,
    openBreaches: ops.breaches?.counts.open ?? derived.breachesOpen ?? 0,
    incidentsOpen: ops.incidents?.counts.open ?? 0,
    queueQueued: ops.queue?.counts.queued ?? ops.remediation?.counts.queued ?? 0,
    queueDlq: ops.queue?.counts.dlq ?? ops.remediation?.counts.dlq ?? 0,
    shippingFailed24h: ops.shipping?.counts.failed24h ?? 0,
    hostVitals: {
      source: "snapshot",
      updatedTs: new Date().toISOString(),
      cpuUsedPercent: derived.cpuUsedPercent,
      cpuCapacityPercent: derived.cpuCapacityPercent,
      cpuCores: derived.cpuCores,
      memoryUsedPercent: derived.memoryUsedPercent,
      memoryCapacityPercent: derived.memoryCapacityPercent,
      memoryUsedMb: derived.memoryUsedMb,
      memoryTotalMb: derived.memoryTotalMb,
      diskUsedPercent: env.last.project_storage?.host_filesystem?.used_percent ?? null,
      diskUsedBytes: env.last.project_storage?.host_filesystem?.used_bytes ?? null,
      diskTotalBytes: env.last.project_storage?.host_filesystem?.total_bytes ?? null,
      diskAvailableBytes: env.last.project_storage?.host_filesystem?.available_bytes ?? null,
    },
  };
}

function sseEvent(name: string, payload: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function sseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

export async function GET(req: Request) {
  if (IS_BUILD_TIME) {
    return new Response(JSON.stringify({ ok: true, skipped: "build" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const [{ requireViewerAccess }, { deriveDashboard }, { getDashboardOpsSnapshot, getStatusEnvelopeSafe }] =
    await Promise.all([
      import("@/lib/rbac"),
      import("@/app/dashboard/_lib/derive"),
      import("@/app/dashboard/_lib/fetch"),
    ]);

  const access = await requireViewerAccess();
  if (!access.ok) {
    return new Response(JSON.stringify({ ok: false, error: access.error }), {
      status: access.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const url = safeRequestUrl(req);
  const intervalMs = parseInterval(url.searchParams.get("intervalMs"));
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let previousCpuSample: CpuSample | null = null;

      const emitPulse = async () => {
        if (closed) return;
        try {
          const snapshotPayload = await buildLivePulse({
            userId: access.identity.userId,
            userRole: access.identity.role,
          }, { deriveDashboard, getDashboardOpsSnapshot, getStatusEnvelopeSafe });
          const live = await readLiveHostVitals({
            fallback: snapshotPayload.hostVitals,
            previousCpuSample,
          });
          previousCpuSample = live.nextCpuSample;
          controller.enqueue(
            encoder.encode(
              sseEvent("pulse", {
                ...snapshotPayload,
                hostVitals: live.hostVitals,
              })
            )
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          controller.enqueue(
            encoder.encode(
              sseEvent("pulse_error", {
                ts: new Date().toISOString(),
                error: detail,
              })
            )
          );
        }
      };

      const timer = setInterval(() => void emitPulse(), intervalMs);
      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseComment(`keepalive ${Date.now()}`)));
      }, 15000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      cleanup = close;
      void emitPulse();

      if (req.signal) {
        req.signal.addEventListener("abort", close);
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

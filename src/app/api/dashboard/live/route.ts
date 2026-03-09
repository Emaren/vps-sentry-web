import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { MAIN_PROJECTS } from "@/app/dashboard/_lib/project-catalog";
import type { DashboardGarbageEstimate } from "@/app/dashboard/_lib/derive";
import { safeRequestUrl } from "@/lib/request-url";

export const dynamic = "force-dynamic";
const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";
const execFileAsync = promisify(execFile);

type ProjectLiveVitals = {
  source: "live" | "partial" | "snapshot";
  updatedTs: string;
  cpuSharePercent: number | null;
  memoryMb: number | null;
  servicesSeen: number;
  servicesExpected: number;
};

type LivePulsePayload = {
  ts: string;
  snapshotTs: string;
  alertsCount: number;
  topAlertSeverity: "critical" | "high" | "medium" | "low" | "info" | "none";
  unexpectedPorts: number;
  authFailed: number;
  authInvalidUser: number;
  threatSignals: number;
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
  projectVitals: Record<string, ProjectLiveVitals>;
  garbageEstimate: DashboardGarbageEstimate | null;
};

type CpuSample = {
  idle: number;
  total: number;
};

type ProcessSample = {
  cpuTotalJiffies: number;
  memoryMb: number | null;
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

function parsePort(value: string): number | null {
  const match = value.match(/:(\d+)$/);
  if (!match) return null;
  const port = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(port) ? port : null;
}

function threatSignalCount(status: Record<string, unknown> | null | undefined): number {
  if (!status || typeof status !== "object") return 0;
  const threat =
    "threat" in status && status.threat && typeof status.threat === "object"
      ? (status.threat as Record<string, unknown>)
      : null;
  if (!threat) return 0;

  let n = 0;
  if (Array.isArray(threat.indicators)) n += threat.indicators.length;
  if (Array.isArray(threat.suspicious_processes)) n += threat.suspicious_processes.length;
  if (Array.isArray(threat.outbound_suspicious)) n += threat.outbound_suspicious.length;
  if (Array.isArray(threat.persistence_hits)) n += threat.persistence_hits.length;
  return n;
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

async function readListeningPortPids(): Promise<Map<number, number[]>> {
  try {
    const { stdout } = await execFileAsync("ss", ["-ltnpH"], {
      timeout: 1500,
      maxBuffer: 1024 * 1024,
    });
    const portPidMap = new Map<number, number[]>();
    for (const rawLine of stdout.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const columns = line.split(/\s+/);
      const localAddress = columns[3] ?? "";
      const port = parsePort(localAddress);
      if (port === null) continue;
      const pids = Array.from(
        new Set(
          Array.from(line.matchAll(/pid=(\d+)/g))
            .map((match) => Number.parseInt(match[1] ?? "", 10))
            .filter((value) => Number.isFinite(value))
        )
      );
      if (!pids.length) continue;
      portPidMap.set(port, pids);
    }
    return portPidMap;
  } catch {
    return new Map();
  }
}

function parseProcessCpuJiffies(raw: string): number | null {
  const closeParenIndex = raw.lastIndexOf(")");
  if (closeParenIndex < 0) return null;
  const after = raw.slice(closeParenIndex + 2).trim().split(/\s+/);
  const utime = Number.parseInt(after[11] ?? "", 10);
  const stime = Number.parseInt(after[12] ?? "", 10);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  return utime + stime;
}

function parseProcessMemoryMb(raw: string): number | null {
  const match = raw.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  if (!match) return null;
  const kb = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(kb) || kb < 0) return null;
  return kb / 1024;
}

async function readProcessSample(pid: number): Promise<ProcessSample | null> {
  try {
    const [statRaw, statusRaw] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile(`/proc/${pid}/status`, "utf8"),
    ]);
    const cpuTotalJiffies = parseProcessCpuJiffies(statRaw);
    if (cpuTotalJiffies === null) return null;
    return {
      cpuTotalJiffies,
      memoryMb: parseProcessMemoryMb(statusRaw),
    };
  } catch {
    return null;
  }
}

async function readLiveProjectVitals(input: {
  currentCpuSample: CpuSample | null;
  previousCpuSample: CpuSample | null;
  previousProcessSamples: Map<number, number>;
}): Promise<{ nextProcessSamples: Map<number, number>; projectVitals: Record<string, ProjectLiveVitals> }> {
  const updatedTs = new Date().toISOString();
  const portPidMap = await readListeningPortPids();
  const interestingPids = new Set<number>();

  for (const project of MAIN_PROJECTS) {
    for (const service of project.services) {
      for (const pid of portPidMap.get(service.port) ?? []) {
        interestingPids.add(pid);
      }
    }
  }

  const sampledPids = await Promise.all(
    Array.from(interestingPids).map(async (pid) => [pid, await readProcessSample(pid)] as const)
  );
  const currentProcessSamples = new Map<number, ProcessSample>();
  const nextProcessSamples = new Map<number, number>();

  for (const [pid, sample] of sampledPids) {
    if (!sample) continue;
    currentProcessSamples.set(pid, sample);
    nextProcessSamples.set(pid, sample.cpuTotalJiffies);
  }

  const totalCpuDelta =
    input.previousCpuSample && input.currentCpuSample
      ? input.currentCpuSample.total - input.previousCpuSample.total
      : null;

  const projectVitals = Object.fromEntries(
    MAIN_PROJECTS.map((project) => {
      const sampledServiceCount = project.services.reduce((count, service) => {
        const hasSamples = (portPidMap.get(service.port) ?? []).some((pid) => currentProcessSamples.has(pid));
        return count + (hasSamples ? 1 : 0);
      }, 0);
      const projectPids = new Set<number>();

      for (const service of project.services) {
        for (const pid of portPidMap.get(service.port) ?? []) {
          if (currentProcessSamples.has(pid)) {
            projectPids.add(pid);
          }
        }
      }

      let memoryMb: number | null = null;
      if (projectPids.size) {
        memoryMb = 0;
        for (const pid of projectPids) {
          memoryMb += currentProcessSamples.get(pid)?.memoryMb ?? 0;
        }
      }

      let cpuSharePercent: number | null = null;
      if (projectPids.size && typeof totalCpuDelta === "number" && totalCpuDelta > 0) {
        let cpuAccumulator = 0;
        let cpuSamplesSeen = 0;
        for (const pid of projectPids) {
          const current = currentProcessSamples.get(pid)?.cpuTotalJiffies;
          const previous = input.previousProcessSamples.get(pid);
          if (typeof current !== "number" || typeof previous !== "number") continue;
          const processDelta = current - previous;
          if (processDelta < 0) continue;
          cpuAccumulator += (processDelta / totalCpuDelta) * 100;
          cpuSamplesSeen += 1;
        }
        cpuSharePercent = cpuSamplesSeen > 0 ? cpuAccumulator : null;
      }

      const source: ProjectLiveVitals["source"] =
        sampledServiceCount === 0
          ? "snapshot"
          : sampledServiceCount === project.services.length
            ? "live"
            : "partial";

      return [
        project.key,
        {
          source,
          updatedTs,
          cpuSharePercent,
          memoryMb,
          servicesSeen: sampledServiceCount,
          servicesExpected: project.services.length,
        },
      ];
    })
  ) satisfies Record<string, ProjectLiveVitals>;

  return {
    nextProcessSamples,
    projectVitals,
  };
}

async function readLiveHostVitals(input: {
  fallback: LivePulsePayload["hostVitals"];
  currentCpuSample: CpuSample | null;
  previousCpuSample: CpuSample | null;
}): Promise<{ hostVitals: LivePulsePayload["hostVitals"] }> {
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

  const liveCpuUsedPercent = cpuPercentBetween(input.previousCpuSample, input.currentCpuSample);
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
    topAlertSeverity: derived.topAlertSeverity,
    unexpectedPorts: derived.publicPortsCount,
    authFailed: env.last.auth?.ssh_failed_password ?? 0,
    authInvalidUser: env.last.auth?.ssh_invalid_user ?? 0,
    threatSignals: threatSignalCount(env.last),
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
    projectVitals: {},
    garbageEstimate: derived.garbageEstimate,
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
      let previousProcessSamples = new Map<number, number>();

      const emitPulse = async () => {
        if (closed) return;
        try {
          const snapshotPayload = await buildLivePulse({
            userId: access.identity.userId,
            userRole: access.identity.role,
          }, { deriveDashboard, getDashboardOpsSnapshot, getStatusEnvelopeSafe });
          const currentCpuSample = await readCpuSample();
          const live = await readLiveHostVitals({
            fallback: snapshotPayload.hostVitals,
            currentCpuSample,
            previousCpuSample,
          });
          const liveProjects = await readLiveProjectVitals({
            currentCpuSample,
            previousCpuSample,
            previousProcessSamples,
          });
          previousCpuSample = currentCpuSample;
          previousProcessSamples = liveProjects.nextProcessSamples;
          controller.enqueue(
            encoder.encode(
              sseEvent("pulse", {
                ...snapshotPayload,
                hostVitals: live.hostVitals,
                projectVitals: liveProjects.projectVitals,
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

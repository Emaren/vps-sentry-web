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
};

function parseInterval(v: string | null): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 5000;
  const t = Math.trunc(n);
  if (t < 2500) return 2500;
  if (t > 30000) return 30000;
  return t;
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

      const emitPulse = async () => {
        if (closed) return;
        try {
          const payload = await buildLivePulse({
            userId: access.identity.userId,
            userRole: access.identity.role,
          }, { deriveDashboard, getDashboardOpsSnapshot, getStatusEnvelopeSafe });
          controller.enqueue(encoder.encode(sseEvent("pulse", payload)));
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

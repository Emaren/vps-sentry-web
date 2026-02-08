import { prisma } from "@/lib/prisma";
import { sendEmailNotification } from "@/lib/notify/email";
import { sendWebhookNotification } from "@/lib/notify/webhook";
import { buildNotifyTestEmailBodies } from "@/lib/notify/templates";

export type NotifyKind = "EMAIL" | "WEBHOOK";

type NotifyEndpointTarget = {
  endpointId: string | null;
  kind: NotifyKind;
  target: string;
  headers?: Record<string, string>;
  source: "saved-endpoint" | "ad-hoc-target" | "fallback-email";
};

type DispatchNotifyTestInput = {
  userId: string;
  requestedByEmail: string;
  hostId?: string | null;
  kind?: NotifyKind | null;
  target?: string | null;
  title?: string | null;
  detail?: string | null;
};

type DispatchNotifyTestAttempt = {
  endpointId: string | null;
  source: NotifyEndpointTarget["source"];
  kind: NotifyKind;
  target: string;
  deliveredOk: boolean;
  status?: number;
  error?: string;
  detail?: string;
};

export type DispatchNotifyTestResult = {
  ok: boolean;
  title: string;
  detail: string;
  attempted: number;
  delivered: number;
  failed: number;
  usedFallback: boolean;
  attempts: DispatchNotifyTestAttempt[];
};

function trimString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max)}...[truncated]`;
}

function parseEndpointMeta(metaJson: string | null): Record<string, unknown> {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseHeaders(metaJson: string | null): Record<string, string> | undefined {
  const meta = parseEndpointMeta(metaJson);
  const headersRaw = meta.headers;
  if (!headersRaw || typeof headersRaw !== "object" || Array.isArray(headersRaw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headersRaw as Record<string, unknown>)) {
    if (typeof v !== "string") continue;
    const key = k.trim();
    const value = v.trim();
    if (!key || !value) continue;
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) continue;
    out[key] = value.slice(0, 800);
  }
  return Object.keys(out).length ? out : undefined;
}

export function inferNotifyKindFromTarget(target: string): NotifyKind | null {
  const t = target.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return "WEBHOOK";
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return "EMAIL";
  return null;
}

function normalizeTitle(v: string | null | undefined): string {
  return trimString(v, 140) ?? "VPS Sentry notification test";
}

function normalizeDetail(v: string | null | undefined): string {
  return (
    trimString(v, 2000) ??
    "This is a manual test notification from VPS Sentry. If you received this, delivery is working."
  );
}

function buildPayload(input: {
  title: string;
  detail: string;
  hostId?: string | null;
  requestedByEmail: string;
}) {
  return {
    type: "notify.test",
    ts: new Date().toISOString(),
    title: input.title,
    detail: input.detail,
    hostId: input.hostId ?? null,
    requestedBy: input.requestedByEmail,
    source: "vps-sentry-web",
  };
}

function normalizeKind(inputKind: string | null | undefined): NotifyKind | null {
  if (!inputKind) return null;
  const k = inputKind.trim().toUpperCase();
  if (k === "EMAIL" || k === "WEBHOOK") return k;
  return null;
}

async function resolveTargets(input: DispatchNotifyTestInput): Promise<{
  targets: NotifyEndpointTarget[];
  usedFallback: boolean;
}> {
  const kind = normalizeKind(input.kind ?? null);
  const target = trimString(input.target ?? null, 1000);

  if (target) {
    const inferred = inferNotifyKindFromTarget(target);
    const resolvedKind = kind ?? inferred;
    if (!resolvedKind) {
      throw new Error("Unable to infer target kind. Use an email address or http(s) URL.");
    }
    return {
      targets: [
        {
          endpointId: null,
          kind: resolvedKind,
          target,
          source: "ad-hoc-target",
        },
      ],
      usedFallback: false,
    };
  }

  const endpoints = await prisma.notificationEndpoint.findMany({
    where: {
      userId: input.userId,
      enabled: true,
      ...(kind ? { kind } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 25,
    select: {
      id: true,
      kind: true,
      target: true,
      metaJson: true,
    },
  });

  const targets: NotifyEndpointTarget[] = endpoints.map((e) => ({
    endpointId: e.id,
    kind: e.kind,
    target: e.target,
    headers: e.kind === "WEBHOOK" ? parseHeaders(e.metaJson) : undefined,
    source: "saved-endpoint",
  }));

  if (targets.length > 0) return { targets, usedFallback: false };

  const fallbackEmail = trimString(input.requestedByEmail, 240);
  if (fallbackEmail && inferNotifyKindFromTarget(fallbackEmail) === "EMAIL") {
    return {
      targets: [
        {
          endpointId: null,
          kind: "EMAIL",
          target: fallbackEmail,
          source: "fallback-email",
        },
      ],
      usedFallback: true,
    };
  }

  return { targets: [], usedFallback: false };
}

export async function dispatchNotifyTest(input: DispatchNotifyTestInput): Promise<DispatchNotifyTestResult> {
  const title = normalizeTitle(input.title);
  const detail = normalizeDetail(input.detail);
  const payload = buildPayload({
    title,
    detail,
    hostId: input.hostId,
    requestedByEmail: input.requestedByEmail,
  });

  const { targets, usedFallback } = await resolveTargets(input);
  const attempts: DispatchNotifyTestAttempt[] = [];

  if (targets.length === 0) {
    return {
      ok: false,
      title,
      detail,
      attempted: 0,
      delivered: 0,
      failed: 0,
      usedFallback,
      attempts: [],
    };
  }

  for (const t of targets) {
    if (t.kind === "EMAIL") {
      const subject = `[VPS Sentry] ${title}`;
      const emailBodies = buildNotifyTestEmailBodies({
        title,
        detail,
        payload,
      });
      const res = await sendEmailNotification({
        to: t.target,
        subject,
        text: emailBodies.text,
        html: emailBodies.html,
      });

      const attempt: DispatchNotifyTestAttempt = {
        endpointId: t.endpointId,
        source: t.source,
        kind: t.kind,
        target: t.target,
        deliveredOk: res.ok,
        error: res.ok ? undefined : res.error,
        detail: res.ok ? undefined : res.detail,
      };
      attempts.push(attempt);

      await prisma.notificationEvent.create({
        data: {
          hostId: input.hostId ?? null,
          endpointId: t.endpointId,
          eventType: "notify.test",
          title,
          detail,
          deliveredOk: res.ok,
          deliveredTs: res.ok ? new Date() : null,
          error: res.ok ? null : [res.error, res.detail].filter(Boolean).join(": "),
          payloadJson: JSON.stringify({
            ...payload,
            delivery: { kind: t.kind, target: t.target, source: t.source },
          }),
        },
      });
      continue;
    }

    const webhookRes = await sendWebhookNotification({
      url: t.target,
      payload,
      headers: t.headers,
    });

    const attempt: DispatchNotifyTestAttempt = {
      endpointId: t.endpointId,
      source: t.source,
      kind: t.kind,
      target: t.target,
      deliveredOk: webhookRes.ok,
      status: webhookRes.status,
      error: webhookRes.ok ? undefined : webhookRes.error,
      detail: webhookRes.detail,
    };
    attempts.push(attempt);

    await prisma.notificationEvent.create({
      data: {
        hostId: input.hostId ?? null,
        endpointId: t.endpointId,
        eventType: "notify.test",
        title,
        detail,
        deliveredOk: webhookRes.ok,
        deliveredTs: webhookRes.ok ? new Date() : null,
        error: webhookRes.ok ? null : [webhookRes.error, webhookRes.detail].filter(Boolean).join(": "),
        payloadJson: JSON.stringify({
          ...payload,
          delivery: { kind: t.kind, target: t.target, source: t.source, status: webhookRes.status },
        }),
      },
    });
  }

  const attempted = attempts.length;
  const delivered = attempts.filter((a) => a.deliveredOk).length;
  const failed = attempted - delivered;

  return {
    ok: failed === 0,
    title,
    detail,
    attempted,
    delivered,
    failed,
    usedFallback,
    attempts,
  };
}

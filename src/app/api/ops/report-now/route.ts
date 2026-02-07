// /var/www/vps-sentry-web/src/app/api/ops/report-now/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import crypto from "node:crypto";

import { inferPublicBaseUrl } from "@/lib/public-url";
import { sendEmail } from "@/lib/mailer";

import { readJsonSafe } from "@/lib/report-now/utils";
import type { StatusJson } from "@/lib/report-now/types";
import { triggerManualReport, pollStatus, STATUS_PATH } from "@/lib/report-now/status";
import { buildReportEmail } from "@/lib/report-now/email";

function toErrMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function json(data: unknown, init?: { status?: number }) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function POST(req: Request) {
  const rid = crypto.randomUUID().slice(0, 8);
  const triggeredAtIso = new Date().toISOString();

  try {
    const session = await getServerSession(authOptions);
    if (!session) return json({ ok: false, error: "Unauthorized", rid }, { status: 401 });

    const requestedBy = (session.user?.email ?? session.user?.name ?? "user").trim();
    const to = session.user?.email?.trim() || null;

    console.log(`[report-now:${rid}] start requestedBy=${requestedBy} to=${to ?? "—"}`);

    // status BEFORE
    const before = await readJsonSafe<StatusJson>(STATUS_PATH);
    const beforeTs = before?.ts ?? null;

    // Trigger agent via path unit
    await triggerManualReport({ rid, requestedBy, reason: "manual-report" });

    // Poll briefly for an updated status snapshot
    const polled = await pollStatus(beforeTs);
    const s: StatusJson | null = polled.status ?? before ?? null;

    console.log(`[report-now:${rid}] status ts=${s?.ts ?? "—"} (before=${beforeTs ?? "—"})`);

    if (!to) {
      return json({
        ok: true,
        rid,
        triggered: true,
        emailed: false,
        warning: "No session email found; cannot send report email.",
        refreshed: polled.refreshed,
        pollMs: polled.pollMs,
        beforeTs,
        statusTs: s?.ts ?? null,
      });
    }

    const baseUrl = inferPublicBaseUrl(req);

    // IMPORTANT: buildReportEmail currently returns { subject, text, html }
    // and its params expect `s` (not `status`) based on your TypeScript errors.
    const { subject, text, html } = buildReportEmail({
      rid,
      requestedBy,
      baseUrl,
      s,
      triggeredAtIso,
      beforeTs,
      pollMs: polled.pollMs,
      refreshed: polled.refreshed,
    });

    // Keep your SMTP guardrails (avoid hanging requests)
    const mail = await sendEmail(
      { to, subject, text, html },
      {
        env: process.env,
        timeouts: {
          sendTimeoutMs: 12_000,
          connectionTimeoutMs: 8_000,
          greetingTimeoutMs: 8_000,
          socketTimeoutMs: 10_000,
        },
      }
    );

    if (!mail.ok) {
      console.log(`[report-now:${rid}] ERROR ${mail.error}${mail.detail ? ` — ${mail.detail}` : ""}`);

      return json(
        {
          ok: false,
          rid,
          triggered: true,
          emailed: false,
          error: mail.error,
          detail: mail.detail,
          code: mail.code,
          refreshed: polled.refreshed,
          pollMs: polled.pollMs,
          beforeTs,
          statusTs: s?.ts ?? null,
        },
        { status: 502 }
      );
    }

    console.log(`[report-now:${rid}] emailed ok to=${to}`);

    return json({
      ok: true,
      rid,
      triggered: true,
      emailed: true,
      to,
      subject,
      refreshed: polled.refreshed,
      pollMs: polled.pollMs,
      beforeTs,
      statusTs: s?.ts ?? null,
    });
  } catch (e: unknown) {
    return json({ ok: false, rid, error: toErrMessage(e) }, { status: 500 });
  }
}

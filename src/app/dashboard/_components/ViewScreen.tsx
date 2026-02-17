"use client";

import React from "react";
import type { Status } from "@/lib/status";
import type { DerivedDashboard } from "../_lib/derive";
import { buildViewScreenMessages, type ViewScreenMessage } from "../_lib/view-screen";

type ViewScreenLivePulse = {
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

function minutesAgo(ts: string): number | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
}

function threatSignalCount(s: Status): number {
  const t = s.threat;
  if (!t || typeof t !== "object") return 0;

  let n = 0;
  if (Array.isArray(t.indicators)) n += t.indicators.length;
  if (Array.isArray(t.suspicious_processes)) n += t.suspicious_processes.length;
  if (Array.isArray(t.outbound_suspicious)) n += t.outbound_suspicious.length;
  if (Array.isArray(t.persistence_hits)) n += t.persistence_hits.length;
  return n;
}

function toneClass(msg: ViewScreenMessage): string {
  if (msg.tone === "bad") return "view-screen-tone-bad";
  if (msg.tone === "warn") return "view-screen-tone-warn";
  if (msg.tone === "ok") return "view-screen-tone-ok";
  return "view-screen-tone-info";
}

export default function ViewScreen(props: {
  status: Status;
  derived: DerivedDashboard;
  initialPulse: ViewScreenLivePulse;
}) {
  const { status, derived, initialPulse } = props;
  const [pulse, setPulse] = React.useState<ViewScreenLivePulse>(initialPulse);
  const [connected, setConnected] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);

  React.useEffect(() => {
    const es = new EventSource("/api/dashboard/live?intervalMs=5000");

    const onOpen = () => setConnected(true);
    const onError = () => setConnected(false);
    const onPulse = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as ViewScreenLivePulse;
        if (!payload || typeof payload !== "object") return;
        setPulse(payload);
      } catch {
        // ignore malformed payload
      }
    };

    es.addEventListener("open", onOpen as EventListener);
    es.addEventListener("error", onError as EventListener);
    es.addEventListener("pulse", onPulse as EventListener);

    return () => {
      es.close();
    };
  }, []);

  const messages = React.useMemo(() => {
    const ageMin = minutesAgo(pulse.snapshotTs);
    const stale = ageMin !== null ? ageMin >= 15 : derived.stale;

    return buildViewScreenMessages({
      host: status.host,
      version: status.version,
      snapshotTs: pulse.snapshotTs,
      snapshotAgeMin: ageMin,
      stale,
      alertsCount: pulse.alertsCount,
      topAlertSeverity: derived.topAlertSeverity,
      unexpectedPorts: pulse.unexpectedPorts,
      authFailed: status.auth?.ssh_failed_password ?? 0,
      authInvalidUser: status.auth?.ssh_invalid_user ?? 0,
      threatSignals: threatSignalCount(status),
      openBreaches: pulse.openBreaches,
      incidentsOpen: pulse.incidentsOpen,
      queueQueued: pulse.queueQueued,
      queueDlq: pulse.queueDlq,
      shippingFailed24h: pulse.shippingFailed24h,
    });
  }, [pulse, derived.stale, derived.topAlertSeverity, status]);

  React.useEffect(() => {
    if (messages.length <= 1) {
      setCursor(0);
      return;
    }

    const timer = setInterval(() => {
      setCursor((prev) => (prev + 1) % messages.length);
    }, 4000);

    return () => clearInterval(timer);
  }, [messages.length]);

  React.useEffect(() => {
    if (cursor < messages.length) return;
    setCursor(0);
  }, [cursor, messages.length]);

  const current = messages[cursor] ?? messages[0];
  const ageMin = minutesAgo(pulse.snapshotTs);
  const ageLabel = ageMin === null ? "unknown age" : `${ageMin}m old`;
  const cadenceLabel = "1 update every 4s";

  return (
    <section className="view-screen-wrap">
      <details className="view-screen-shell" open>
        <summary className="view-screen-summary">
          <div className="view-screen-summary-left">
            <span className="view-screen-title">View Screen</span>
            <span className="view-screen-subtitle">
              Plain-language bridge feed from all major sensors
            </span>
          </div>
          <div className="view-screen-summary-right">
            <span className={connected ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip dashboard-chip-warn"}>
              {connected ? "live stream" : "snapshot mode"}
            </span>
          </div>
        </summary>

        <div className="view-screen-body">
          <div className="view-screen-meta-row">
            <span className={`view-screen-sensor ${toneClass(current)}`}>{current.sensor}</span>
            <span className="view-screen-meta-dot" aria-hidden="true" />
            <span className="view-screen-meta-text">
              {cadenceLabel} · message {Math.min(cursor + 1, messages.length)}/{messages.length}
            </span>
          </div>

          <textarea
            readOnly
            rows={3}
            className={`view-screen-textbox ${toneClass(current)}`}
            value={`${current.line1}${current.line2 ? `\n${current.line2}` : ""}`}
            aria-label="View Screen feed"
          />

          <div className="view-screen-footer">
            Host {status.host} · Snapshot {ageLabel}
          </div>
        </div>
      </details>
    </section>
  );
}

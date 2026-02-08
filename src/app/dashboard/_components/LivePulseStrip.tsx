"use client";

import React from "react";
import { fmt } from "@/lib/status";

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

function pulseChipClass(value: number, warnAt = 1, badAt = 1): string {
  if (value >= badAt) return "dashboard-chip dashboard-chip-bad";
  if (value >= warnAt) return "dashboard-chip dashboard-chip-warn";
  return "dashboard-chip dashboard-chip-ok";
}

export default function LivePulseStrip(props: {
  initial: LivePulsePayload;
}) {
  const [pulse, setPulse] = React.useState<LivePulsePayload>(props.initial);
  const [connected, setConnected] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const es = new EventSource("/api/dashboard/live?intervalMs=5000");

    const onOpen = () => {
      setConnected(true);
      setLastError(null);
    };
    const onError = () => {
      setConnected(false);
      setLastError("reconnecting");
    };
    const onPulse = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as LivePulsePayload;
        if (!payload || typeof payload !== "object") return;
        setPulse(payload);
      } catch {
        // ignore malformed pulse payloads
      }
    };

    es.addEventListener("open", onOpen as EventListener);
    es.addEventListener("error", onError as EventListener);
    es.addEventListener("pulse", onPulse as EventListener);

    return () => {
      es.close();
    };
  }, []);

  return (
    <section style={{ marginTop: 12 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>Live Pulse</h2>
        <span className={connected ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip dashboard-chip-warn"}>
          {connected ? "streaming" : lastError ?? "disconnected"}
        </span>
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginTop: 6 }}>
        Snapshot: <b>{fmt(pulse.snapshotTs)}</b> · Updated: <b>{fmt(pulse.ts)}</b>
      </div>

      <div className="dashboard-chip-row" style={{ marginTop: 10 }}>
        <span className={pulseChipClass(pulse.alertsCount, 1, 1)}>alerts {pulse.alertsCount}</span>
        <span className={pulseChipClass(pulse.unexpectedPorts, 1, 1)}>unexpected ports {pulse.unexpectedPorts}</span>
        <span className={pulseChipClass(pulse.openBreaches, 1, 1)}>open breaches {pulse.openBreaches}</span>
        <span className={pulseChipClass(pulse.incidentsOpen, 1, 1)}>incidents open {pulse.incidentsOpen}</span>
        <span className={pulseChipClass(pulse.queueQueued, 1, 1)}>queue {pulse.queueQueued}</span>
        <span className={pulseChipClass(pulse.queueDlq, 1, 1)}>dlq {pulse.queueDlq}</span>
        <span className={pulseChipClass(pulse.shippingFailed24h, 1, 1)}>ship fails 24h {pulse.shippingFailed24h}</span>
      </div>
    </section>
  );
}

"use client";

import React from "react";
import type { Status } from "@/lib/status";
import type { DerivedDashboard } from "../_lib/derive";
import {
  buildViewScreenMessages,
  pickNextViewScreenMessage,
  type ViewScreenMessage,
} from "../_lib/view-screen";

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

function toneClass(msg: { tone: ViewScreenMessage["tone"] }): string {
  if (msg.tone === "bad") return "view-screen-tone-bad";
  if (msg.tone === "warn") return "view-screen-tone-warn";
  if (msg.tone === "ok") return "view-screen-tone-ok";
  return "view-screen-tone-info";
}

type ViewScreenEntry = {
  id: string;
  ts: string;
  sensor: string;
  tone: ViewScreenMessage["tone"];
  line1: string;
  line2?: string;
};

function fmtClock(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function isNearBottom(el: HTMLDivElement, threshold = 32): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

export default function ViewScreen(props: {
  status: Status;
  derived: DerivedDashboard;
  initialPulse: ViewScreenLivePulse;
}) {
  const { status, derived, initialPulse } = props;
  const [pulse, setPulse] = React.useState<ViewScreenLivePulse>(initialPulse);
  const [connected, setConnected] = React.useState(false);
  const [entries, setEntries] = React.useState<ViewScreenEntry[]>([]);
  const [followTail, setFollowTail] = React.useState(true);
  const [pausedUnread, setPausedUnread] = React.useState(0);
  const feedRef = React.useRef<HTMLDivElement | null>(null);
  const nextCursorRef = React.useRef(0);
  const lastFingerprintRef = React.useRef<string | null>(null);
  const entryCounterRef = React.useRef(0);
  const followTailRef = React.useRef(true);

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
    const pick = pickNextViewScreenMessage(messages, {
      cursor: nextCursorRef.current,
      lastFingerprint: lastFingerprintRef.current,
    });

    if (!pick.message) {
      return;
    }

    nextCursorRef.current = pick.nextCursor;
    lastFingerprintRef.current = pick.fingerprint;

    entryCounterRef.current += 1;
    const nextEntry: ViewScreenEntry = {
      id: `${pulse.ts}-${entryCounterRef.current}`,
      ts: pulse.ts,
      sensor: pick.message.sensor,
      tone: pick.message.tone,
      line1: pick.message.line1,
      line2: pick.message.line2,
    };

    setEntries((prev) => {
      const out = [...prev, nextEntry];
      if (out.length > 250) return out.slice(out.length - 250);
      return out;
    });
  }, [messages, pulse.ts]);

  React.useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (followTailRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setPausedUnread((prev) => prev + 1);
    }
  }, [entries.length]);

  const onFeedScroll = React.useCallback(() => {
    const el = feedRef.current;
    if (!el) return;

    const nextFollowTail = isNearBottom(el);
    if (nextFollowTail !== followTailRef.current) {
      followTailRef.current = nextFollowTail;
      setFollowTail(nextFollowTail);
      if (nextFollowTail) setPausedUnread(0);
    }
  }, []);

  const jumpToLatest = React.useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    followTailRef.current = true;
    setFollowTail(true);
    setPausedUnread(0);
  }, []);

  const ageMin = minutesAgo(pulse.snapshotTs);
  const ageLabel = ageMin === null ? "unknown age" : `${ageMin}m old`;
  const cadenceLabel = "1 update every 5s";

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
            <span className="view-screen-meta-dot" aria-hidden="true" />
            <span className="view-screen-meta-text">
              {cadenceLabel} · history {entries.length} line(s) · {followTail ? "following newest" : "scroll paused"}
            </span>
            {!followTail ? (
              <button type="button" className="view-screen-jump-btn" onClick={jumpToLatest}>
                Jump to latest{pausedUnread > 0 ? ` (${pausedUnread})` : ""}
              </button>
            ) : null}
          </div>

          <div className="view-screen-feed" ref={feedRef} onScroll={onFeedScroll} aria-label="View Screen feed history">
            {entries.length === 0 ? (
              <div className="view-screen-empty">Waiting for first sensor update...</div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="view-screen-entry">
                  <div className="view-screen-entry-head">
                    <span className="view-screen-entry-ts">{fmtClock(entry.ts)}</span>
                    <span className={`view-screen-sensor ${toneClass(entry)}`}>
                      {entry.sensor}
                    </span>
                  </div>
                  <div className="view-screen-entry-line1">{entry.line1}</div>
                  {entry.line2 ? <div className="view-screen-entry-line2">{entry.line2}</div> : null}
                </div>
              ))
            )}
          </div>

          <div className="view-screen-footer">
            Host {status.host} · Snapshot {ageLabel} · Scroll up to review prior updates.
          </div>
        </div>
      </details>
    </section>
  );
}

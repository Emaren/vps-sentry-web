export type ViewScreenTone = "ok" | "warn" | "bad" | "info";

export type ViewScreenMessage = {
  id: string;
  sensor: string;
  tone: ViewScreenTone;
  line1: string;
  line2?: string;
};

export type ViewScreenPickerState = {
  cursor: number;
  lastFingerprint: string | null;
};

export type ViewScreenModel = {
  host: string;
  version: string;
  snapshotTs: string;
  snapshotAgeMin: number | null;
  stale: boolean;
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
};

export function buildViewScreenMessages(input: ViewScreenModel): ViewScreenMessage[] {
  const out: ViewScreenMessage[] = [];

  out.push({
    id: "bridge-core",
    sensor: "Bridge Core",
    tone: input.stale ? "warn" : "ok",
    line1: input.stale
      ? `Latest scan from ${input.host} is stale. Some data may be old.`
      : `Latest scan from ${input.host} is fresh and connected.`,
    line2:
      input.snapshotAgeMin === null
        ? `Agent version ${input.version}.`
        : `Snapshot age is about ${input.snapshotAgeMin} minute(s). Agent version ${input.version}.`,
  });

  if (input.alertsCount > 0) {
    out.push({
      id: "alert-radar",
      sensor: "Alert Radar",
      tone:
        input.topAlertSeverity === "critical" || input.topAlertSeverity === "high"
          ? "bad"
          : "warn",
      line1: `${input.alertsCount} actionable alert(s) need attention now.`,
      line2:
        input.topAlertSeverity === "none"
          ? "The system sees risky changes worth checking."
          : `Top severity in this window: ${input.topAlertSeverity}.`,
    });
  }

  if (input.unexpectedPorts > 0) {
    out.push({
      id: "port-sentinel",
      sensor: "Port Sentinel",
      tone: "bad",
      line1: `${input.unexpectedPorts} unexpected public port(s) are internet-facing.`,
      line2: "Simple meaning: something is exposed that was likely not planned.",
    });
  }

  if (input.threatSignals > 0) {
    out.push({
      id: "threat-hunter",
      sensor: "Threat Hunter",
      tone: "bad",
      line1: `${input.threatSignals} runtime threat signal(s) were reported.`,
      line2: "This usually means suspicious behavior, not just config drift.",
    });
  }

  if (input.authFailed > 0 || input.authInvalidUser > 0) {
    out.push({
      id: "auth-watch",
      sensor: "Auth Watch",
      tone: "warn",
      line1: `SSH noise seen: ${input.authFailed} failed password + ${input.authInvalidUser} invalid-user attempt(s).`,
      line2: "Often scanner traffic, but spikes can hide real intrusion attempts.",
    });
  }

  if (input.openBreaches > 0) {
    out.push({
      id: "breach-ledger",
      sensor: "Breach Ledger",
      tone: "warn",
      line1: `${input.openBreaches} breach record(s) are still open.`,
      line2: "Open means unresolved security items still in your queue.",
    });
  }

  if (input.incidentsOpen > 0) {
    out.push({
      id: "incident-ops",
      sensor: "Incident Ops",
      tone: "warn",
      line1: `${input.incidentsOpen} incident(s) are active in workflow.`,
      line2: "Acknowledge/resolve flow is in progress or waiting on action.",
    });
  }

  if (input.queueDlq > 0 || input.queueQueued > 0) {
    const tone: ViewScreenTone = input.queueDlq > 0 ? "bad" : "warn";
    out.push({
      id: "response-queue",
      sensor: "Response Queue",
      tone,
      line1: `Queue status: ${input.queueQueued} queued, ${input.queueDlq} in DLQ.`,
      line2:
        input.queueDlq > 0
          ? "Queue debt needs operator review. Security status can still be OK if host telemetry is clean."
          : "Queued runs are waiting to execute under safety guardrails.",
    });
  }

  if (input.shippingFailed24h > 0) {
    out.push({
      id: "notify-relay",
      sensor: "Notify Relay",
      tone: "warn",
      line1: `${input.shippingFailed24h} notification delivery failure(s) in the last 24h.`,
      line2: "Alerts might not reach email/webhook targets reliably.",
    });
  }

  if (
    input.alertsCount === 0 &&
    input.unexpectedPorts === 0 &&
    input.threatSignals === 0 &&
    input.authFailed === 0 &&
    input.authInvalidUser === 0 &&
    input.openBreaches === 0 &&
    input.incidentsOpen === 0 &&
    input.queueQueued === 0 &&
    input.queueDlq === 0 &&
    input.shippingFailed24h === 0 &&
    !input.stale
  ) {
    out.push({
      id: "mission-control-all-clear",
      sensor: "Mission Control",
      tone: "ok",
      line1: "All core sensors are calm right now.",
      line2: "No actionable alerts, unexpected ports, or open incidents.",
    });
  }

  if (out.length < 2) {
    out.push({
      id: "operator-guide",
      sensor: "Operator Guide",
      tone: "info",
      line1: "This feed translates complex telemetry into plain language.",
      line2: "Use it as the quick summary, then open panels for deep detail.",
    });
  }

  return out;
}

export function viewScreenMessageFingerprint(msg: ViewScreenMessage): string {
  return `${msg.sensor}|${msg.tone}|${msg.line1}|${msg.line2 ?? ""}`;
}

/**
 * Picks exactly one message for the next feed tick (3-5s cadence target).
 * Prefers not to repeat the immediate previous message when alternatives exist.
 */
export function pickNextViewScreenMessage(
  messages: ViewScreenMessage[],
  state: ViewScreenPickerState
): { message: ViewScreenMessage | null; nextCursor: number; fingerprint: string | null } {
  if (!messages.length) {
    return { message: null, nextCursor: 0, fingerprint: null };
  }

  const len = messages.length;
  const start = ((state.cursor % len) + len) % len;

  let selected = messages[start];
  let selectedIndex = start;
  let selectedFingerprint = viewScreenMessageFingerprint(selected);

  if (state.lastFingerprint && len > 1 && selectedFingerprint === state.lastFingerprint) {
    for (let i = 1; i < len; i++) {
      const idx = (start + i) % len;
      const candidate = messages[idx];
      const candidateFingerprint = viewScreenMessageFingerprint(candidate);
      if (candidateFingerprint !== state.lastFingerprint) {
        selected = candidate;
        selectedIndex = idx;
        selectedFingerprint = candidateFingerprint;
        break;
      }
    }
  }

  return {
    message: selected,
    nextCursor: (selectedIndex + 1) % len,
    fingerprint: selectedFingerprint,
  };
}

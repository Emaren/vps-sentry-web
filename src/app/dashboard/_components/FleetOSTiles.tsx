import React from "react";
import type { FleetProjection, FleetPlane } from "@/lib/kingdom-os/fleet";

const TONES = {
  LIVE: { border: "#42d98b", glow: "rgba(34,197,94,.15)", text: "#50e9a0" },
  STALE: { border: "#f7bc51", glow: "rgba(245,158,11,.13)", text: "#fcd078" },
  UNVERIFIED: { border: "#f06d75", glow: "rgba(239,68,68,.12)", text: "#fb929a" },
} as const;

function size(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let n = value, k = 0;
  while (n >= 1024 && k < units.length - 1) { n /= 1024; k++; }
  return n.toFixed(k === 0 || n >= 10 ? 0 : 1) + " " + units[k];
}

function card(p: FleetPlane) {
  const e = p.evidence;
  const tone = TONES[e.state];
  return (
    <article key={p.id} data-fleet-scope={p.id} data-fleet-state={e.state}
      style={{
        padding: "16px", borderRadius: "14px",
        background: "linear-gradient(145deg, " + tone.glow + ",rgba(8,17,23,.38))",
        border: "1px solid " + tone.border,
        boxShadow: "0 0 18px " + tone.glow,
        minWidth: 0,
      }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <strong>{p.label}</strong>
        <span style={{ color: tone.text, fontSize: 12, fontWeight: 750 }}>{e.state}</span>
      </div>
      <div style={{ fontSize: 25, marginTop: 12, fontVariantNumeric: "tabular-nums" }}>
        {p.capacity ? size(p.capacity.availableBytes) : "No verified bytes"}
      </div>
      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
        {p.capacity
          ? "Free · " + p.capacity.usedPercent.toFixed(1) + "% used · total " + size(p.capacity.totalBytes)
          : "Source admission missing; not claiming the machine is powered off"}
      </div>
      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 11 }}>
        {e.observedAt ? "Observed " + e.observedAt : "No authenticated observation"}
      </div>
      <div style={{ fontSize: 11, opacity: 0.75, marginTop: 3 }}>
        {e.producer} · {e.coverage} · TTL {e.ttlSeconds === null ? "n/a" : e.ttlSeconds + "s"}
      </div>
      {e.reason ? <p style={{ color: tone.text, fontSize: 12, marginTop: 8 }}>{e.reason}</p> : null}
      <a href={p.link} style={{ display: "inline-block", fontSize: 12, marginTop: 10 }}>
        Open Storage Explorer
      </a>
    </article>
  );
}

export default function FleetOSTiles({ fleet }: { fleet: FleetProjection | null }) {
  if (!fleet) {
    return (
      <section aria-label="VPSSentry fleet OS" style={{ margin: "16px 0", opacity: .8 }}>
        <h2>Fleet OS · source unavailable</h2>
        <p>Root-owned VPSSentry status could not be verified. No fabricated host values are displayed.</p>
      </section>
    );
  }
  return (
    <section aria-label="VPSSentry fleet OS" style={{ margin: "18px 0" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>VPSSentry OS · Fleet Health</h2>
          <p style={{ margin: "4px 0 12px", fontSize: 12, opacity: .75 }}>
            Authoritative HEL1 agent observations · explicit provenance and freshness
          </p>
        </div>
        <span style={{ fontSize: 12, opacity: .8 }}>
          Agent {fleet.sourceStatus.state} · {fleet.sourceStatus.observedAt ?? "no timestamp"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
        {fleet.planes.map(card)}
      </div>
      <div style={{
        padding: "12px 15px", marginTop: 12,
        border: "1px solid rgba(150,175,184,.35)", borderRadius: 12,
        background: "rgba(20,32,39,.28)", fontSize: 13,
      }}>
        <strong>Reclaim versus root pressure</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "9px 22px", marginTop: 8 }}>
          <span>Safe now: <b>{size(fleet.reclaim.safeNowBytes)}</b></span>
          <span>Guided on root: <b>{size(fleet.reclaim.rootBytes)}</b></span>
          <span>Guided on volume: <b>{size(fleet.reclaim.mountedVolumeBytes)}</b></span>
          <span>Unclassified: <b>{size(fleet.reclaim.unknownScopeBytes)}</b></span>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: .75 }}>
          Guided is a REVIEW category, never an executable cleanup authorization.
          Catalog: {fleet.reclaim.evidence.state} · {fleet.reclaim.evidence.observedAt ?? "unavailable"}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: .8 }}>
          Active agent alerts: {fleet.alerts.length} · publicly bound listeners: {fleet.ports.length}
          {" · "}no systemd/timer/failure metrics inferred from unrelated sources
        </div>
      </div>
    </section>
  );
}

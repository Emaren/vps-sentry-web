import React from "react";
import type { DerivedDashboard } from "../_lib/derive";
import Box from "./Box";

type PortEntry = {
  proto?: string;
  host?: string;
  port?: number | string;
  pid?: number | string;
  proc?: string;
  public?: boolean;
  raw?: string;
  sig?: string;
};

type ProjectService = {
  label: string;
  port: number;
  required?: boolean;
};

type ProjectDef = {
  key: string;
  name: string;
  subtitle: string;
  href?: string;
  backendHref?: string;
  services: ProjectService[];
};

function fmtPercent(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${Math.max(0, Math.min(100, Math.round(v)))}%`;
}

function fmtRatio(used: number | null, capacity: number): string {
  if (typeof used !== "number" || !Number.isFinite(used)) return `—/${Math.round(capacity)}%`;
  return `${Math.max(0, Math.min(100, Math.round(used)))}/${Math.round(capacity)}%`;
}

function fmtSizeFromMb(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return "—";
  if (v >= 1024) return `${(v / 1024).toFixed(v >= 10 * 1024 ? 0 : 1)}GB`;
  return `${Math.round(v)}MB`;
}

function clampBar(v: number | null): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isTcp(proto: string | undefined): boolean {
  if (!proto) return true; // some sources omit it
  return proto.toLowerCase().startsWith("tcp");
}

function scorePortArray(arr: PortEntry[]) {
  const sample = arr.slice(0, 12);
  let looks = 0;
  let tcp = 0;
  let pubT = 0;
  let pubF = 0;

  for (const e of sample) {
    const p = toInt(e?.port);
    const pid = toInt(e?.pid);
    if (typeof p === "number" && typeof pid === "number") looks++;
    if (isTcp(e?.proto)) tcp++;
    if (e?.public === true) pubT++;
    if (e?.public === false) pubF++;
  }

  // heuristics: reward arrays that look like port lists + contain TCP + contain explicit public flags
  const score = looks * 10 + tcp * 3 + pubF * 2 + pubT * 2 + Math.min(arr.length, 60);
  return { score, looks, tcp, pubT, pubF };
}

/**
 * Try hard to find ports arrays anywhere inside `derived`.
 * - prefers paths named ports_local/ports_public
 * - otherwise picks the best-scoring “port list looking” arrays and splits by `.public`
 */
function pickPortsFromDerived(d: DerivedDashboard): { local: PortEntry[]; pub: PortEntry[]; debug: string } {
  const root = d as unknown as Record<string, unknown>;

  // 1) direct top-level keys (just in case derive flattens)
  const directLocal = safeArray<PortEntry>(root["ports_local"] ?? root["portsLocal"]);
  const directPub = safeArray<PortEntry>(root["ports_public"] ?? root["portsPublic"]);
  if (directLocal.length || directPub.length) {
    return {
      local: directLocal,
      pub: directPub,
      debug: `direct: local=${directLocal.length} pub=${directPub.length}`,
    };
  }

  // 2) common “status-ish” containers
  const candidates: unknown[] = [
    root["canonicalStatus"],
    root["canonical_status"],
    root["statusCanonical"],
    root["status_canonical"],
    root["status"],
    root["hostStatus"],
    root["rawStatus"],
  ].filter(Boolean);

  for (const c of candidates) {
    const r = asRecord(c);
    const loc = safeArray<PortEntry>(r["ports_local"] ?? r["portsLocal"]);
    const pub = safeArray<PortEntry>(r["ports_public"] ?? r["portsPublic"]);
    if (loc.length || pub.length) {
      return {
        local: loc,
        pub,
        debug: `statusCandidate: local=${loc.length} pub=${pub.length}`,
      };
    }
  }

  // 3) bounded BFS over derived to find any arrays that look like ports
  const hits: Array<{ path: string; arr: PortEntry[]; score: number; pubT: number; pubF: number }> = [];
  const seen = new WeakSet<object>();
  const q: Array<{ v: unknown; path: string; depth: number }> = [{ v: d, path: "derived", depth: 0 }];

  let visited = 0;
  const MAX_NODES = 1200;
  const MAX_DEPTH = 6;

  while (q.length && visited < MAX_NODES) {
    const cur = q.shift()!;
    visited++;

    if (!cur || typeof cur.v !== "object") continue;

    const obj = cur.v as object;
    if (seen.has(obj)) continue;
    seen.add(obj);

    if (Array.isArray(cur.v)) {
      // only traverse a few elements to avoid explosion
      const arr = cur.v as unknown[];
      for (let i = 0; i < Math.min(arr.length, 6); i++) {
        q.push({ v: arr[i], path: `${cur.path}[${i}]`, depth: cur.depth + 1 });
      }
      continue;
    }

    const rec = cur.v as Record<string, unknown>;
    for (const [k, vv] of Object.entries(rec)) {
      const path = `${cur.path}.${k}`;

      if (Array.isArray(vv) && vv.length && typeof vv[0] === "object") {
        const arr = vv as PortEntry[];

        // “looks like port list” = at least a couple entries with port+pid
        const { score, looks, pubT, pubF } = scorePortArray(arr);
        if (looks >= 2) hits.push({ path, arr, score, pubT, pubF });
      }

      if (cur.depth < MAX_DEPTH) {
        q.push({ v: vv, path, depth: cur.depth + 1 });
      }
    }
  }

  if (!hits.length) return { local: [], pub: [], debug: "bfs: none" };

  // Prefer explicit name matches
  const namedLocal = hits
    .filter((h) => /ports[_-]?local|portsLocal/i.test(h.path))
    .sort((a, b) => b.score - a.score)[0];
  const namedPub = hits
    .filter((h) => /ports[_-]?public|portsPublic/i.test(h.path))
    .sort((a, b) => b.score - a.score)[0];

  if (namedLocal || namedPub) {
    return {
      local: namedLocal?.arr ?? [],
      pub: namedPub?.arr ?? [],
      debug: `bfs:named local=${namedLocal?.arr.length ?? 0} pub=${namedPub?.arr.length ?? 0}`,
    };
  }

  // Otherwise choose best overall and split by `.public`
  const best = hits.sort((a, b) => b.score - a.score)[0];
  const pub = best.arr.filter((x) => x.public === true);
  const local = best.arr.filter((x) => x.public === false);

  // If no `.public` flags exist, treat it as local
  const fallbackLocal = local.length || pub.length ? local : best.arr;

  return {
    local: fallbackLocal,
    pub,
    debug: `bfs:best path=${best.path} local=${fallbackLocal.length} pub=${pub.length}`,
  };
}

function findPort(ports: PortEntry[], port: number): PortEntry | undefined {
  return ports.find((p) => {
    const pport = toInt(p?.port);
    return pport === port && isTcp(p.proto);
  });
}

function sumMaybe(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0);
}

function resolveBackendHref(project: Pick<ProjectDef, "subtitle" | "backendHref">): string | undefined {
  if (project.backendHref?.trim()) return project.backendHref.trim();
  const subtitle = project.subtitle?.trim();
  if (!subtitle) return undefined;
  if (subtitle.startsWith("http://") || subtitle.startsWith("https://")) return subtitle;
  return `https://${subtitle}`;
}

/**
 * NOTE: These ports are your current “main project” ports on this VPS.
 * If you ever change service ports, update them here.
 */
const MAIN_PROJECTS: ProjectDef[] = [
  {
    key: "vps-sentry",
    name: "VPS Sentry",
    subtitle: "vps-sentry.tokentap.ca/api/status",
    href: "https://vps-sentry.tokentap.ca",
    backendHref: "https://vps-sentry.tokentap.ca/api/status",
    services: [{ label: "web", port: 3035, required: true }],
  },
  {
    key: "tokentap",
    name: "TokenTap",
    subtitle: "api.tokentap.ca",
    href: "https://tokentap.ca",
    backendHref: "https://api.tokentap.ca",
    services: [
      { label: "web", port: 3020, required: true },
      { label: "api", port: 3320, required: true },
    ],
  },
  {
    key: "pulse",
    name: "Pulse",
    subtitle: "api.pulse.tokentap.ca",
    href: "https://pulse.tokentap.ca",
    backendHref: "https://api.pulse.tokentap.ca",
    services: [
      { label: "web", port: 3090, required: true },
      { label: "api", port: 3390, required: true },
    ],
  },
  {
    key: "llama",
    name: "Llama",
    subtitle: "llama-api.tokentap.ca",
    href: "https://llama.tokentap.ca",
    backendHref: "https://llama-api.tokentap.ca",
    services: [
      { label: "api", port: 3360, required: true },
      { label: "chat-api", port: 3350, required: true },
      { label: "landing", port: 3070 },
    ],
  },
  {
    key: "aoe2hdbets",
    name: "AoE2HDBets",
    subtitle: "api-prodn.aoe2hdbets.com",
    href: "https://aoe2hdbets.com",
    backendHref: "https://api-prodn.aoe2hdbets.com",
    services: [
      { label: "web", port: 3030, required: true },
      { label: "api", port: 3330, required: true },
    ],
  },
  {
    key: "wheatandstone",
    name: "Wheat & Stone",
    subtitle: "api.wheatandstone.ca",
    href: "https://wheatandstone.ca",
    backendHref: "https://api.wheatandstone.ca",
    services: [
      { label: "web", port: 3010, required: true },
      { label: "api", port: 3310, required: true },
    ],
  },
  {
    key: "redlinelegal",
    name: "Redline Legal",
    subtitle: "api.redlinelegal.ca",
    href: "https://redlinelegal.ca",
    backendHref: "https://api.redlinelegal.ca",
    services: [
      { label: "web", port: 3040, required: true },
      { label: "api", port: 3340, required: true },
    ],
  },
  {
    key: "4o",
    name: "4o API",
    subtitle: "api.4o.tokentap.ca",
    href: "https://api.4o.tokentap.ca",
    services: [{ label: "api", port: 3380, required: true }],
  },
];

export default function PowerMemoryTile(props: { derived: DerivedDashboard }) {
  const { derived: d } = props;

  // Old process ranking (under “Processes” view).
  const topRows = d.vitalsProcesses.filter((x) => !x.isOther).slice(0, 5);
  const otherRow = d.vitalsProcesses.find((x) => x.isOther);
  const rows = otherRow ? [...topRows, otherRow] : topRows;

  const { local: portsLocal, pub: portsPublic, debug: portsDebug } = pickPortsFromDerived(d);

  // PID -> vitals row (handle pid being number OR string)
  const pidToVitals = new Map<number, (typeof d.vitalsProcesses)[number]>();
  for (const vp of d.vitalsProcesses) {
    const pid = toInt((vp as unknown as { pid?: unknown })?.pid);
    if (typeof pid === "number") pidToVitals.set(pid, vp);
  }

  const projectCards = MAIN_PROJECTS.map((proj) => {
    const backendHrefResolved = resolveBackendHref(proj);
    const services = proj.services.map((svc) => {
      const local = findPort(portsLocal, svc.port);
      const pub = findPort(portsPublic, svc.port);
      const portEntry = local ?? pub;

      const pid = toInt(portEntry?.pid);
      const vitals = typeof pid === "number" ? pidToVitals.get(pid) : undefined;

      return {
        ...svc,
        isListening: Boolean(portEntry),
        isPublic: Boolean(pub),
        pid: pid ?? undefined,
        cpuSharePercent: vitals?.cpuSharePercent ?? null,
        memoryMb: vitals?.memoryMb ?? null,
      };
    });

    const required = services.filter((s) => s.required);
    const allRequiredUp = required.every((s) => s.isListening);
    const requiredUpCount = required.filter((s) => s.isListening).length;
    const listeningCount = services.filter((s) => s.isListening).length;
    const publicCount = services.filter((s) => s.isPublic).length;
    const missingRequired = required.filter((s) => !s.isListening).map((s) => `${s.label}:${s.port}`);

    const cpuSum = sumMaybe(services.map((s) => s.cpuSharePercent));
    const memSum = sumMaybe(services.map((s) => s.memoryMb));
    const cpuBarPercent = clampBar(cpuSum);
    const memBarPercent =
      typeof memSum === "number" && typeof d.memoryTotalMb === "number" && d.memoryTotalMb > 0
        ? clampBar((memSum / d.memoryTotalMb) * 100)
        : 0;

    const portsLabel = services
      .map((s) => {
        const pubTag = s.isPublic ? "(pub)" : "";
        const pidTag = typeof s.pid === "number" ? `#${s.pid}` : "";
        return `${s.label}:${s.port}${pubTag}${pidTag ? ` ${pidTag}` : ""}`;
      })
      .join(" · ");

    return {
      ...proj,
      backendHrefResolved,
      services,
      up: allRequiredUp,
      requiredUpCount,
      requiredCount: required.length,
      listeningCount,
      publicCount,
      missingRequired,
      cpuSharePercent: cpuSum,
      cpuBarPercent,
      memoryMb: memSum,
      memoryBarPercent: memBarPercent,
      portsLabel,
    };
  });

  return (
    <section className="power-vitals-wrap">
      <Box className="power-vitals-shell">
        <div className="power-vitals-head">
          <div>
            <h2 className="power-vitals-title">Power / Memory</h2>
            <p className="power-vitals-subtitle">
              VPS health at-a-glance, with per-project status (ports + PID vitals) and a full process view.
            </p>
          </div>
          <span className={d.hasVitals ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip dashboard-chip-warn"}>
            {d.hasVitals ? "snapshot ready" : "waiting telemetry"}
          </span>
        </div>

        <div className="power-vitals-kpi-grid">
          <div className="power-vitals-kpi-card">
            <div className="power-vitals-kpi-label">Power</div>
            <div className="power-vitals-kpi-value">{fmtRatio(d.cpuUsedPercent, d.cpuCapacityPercent)}</div>
            <div className="power-vitals-kpi-meta">
              VPS CPU used right now{typeof d.cpuCores === "number" ? ` · ${d.cpuCores} core(s)` : ""}.
            </div>
            <div className="power-vitals-bar">
              <span style={{ width: `${clampBar(d.cpuUsedPercent)}%` }} />
            </div>
          </div>

          <div className="power-vitals-kpi-card">
            <div className="power-vitals-kpi-label">Memory</div>
            <div className="power-vitals-kpi-value">{fmtRatio(d.memoryUsedPercent, d.memoryCapacityPercent)}</div>
            <div className="power-vitals-kpi-meta">
              {fmtSizeFromMb(d.memoryUsedMb)} used{d.memoryTotalMb ? ` of ${fmtSizeFromMb(d.memoryTotalMb)}` : ""}.
            </div>
            <div className="power-vitals-bar">
              <span style={{ width: `${clampBar(d.memoryUsedPercent)}%` }} />
            </div>
          </div>
        </div>

        {/* CSS-only toggles (no client JS) */}
        <input className="pm-toggle-input" type="radio" id="pm-mode-projects" name="pm-mode" defaultChecked />
        <input className="pm-toggle-input" type="radio" id="pm-mode-processes" name="pm-mode" />
        <input className="pm-toggle-input" type="radio" id="pm-layout-tiles" name="pm-layout" defaultChecked />
        <input className="pm-toggle-input" type="radio" id="pm-layout-list" name="pm-layout" />

        <div className="power-vitals-controls">
          <div className="pm-toggle-group" role="tablist" aria-label="Power panel mode">
            <label className="pm-toggle-label" htmlFor="pm-mode-projects">
              Projects
            </label>
            <label className="pm-toggle-label" htmlFor="pm-mode-processes">
              Processes
            </label>
          </div>

          <div className="pm-toggle-group" role="tablist" aria-label="Project view layout">
            <label className="pm-toggle-label" htmlFor="pm-layout-tiles">
              Tiles
            </label>
            <label className="pm-toggle-label" htmlFor="pm-layout-list">
              List
            </label>
          </div>
        </div>

        {/* PROJECTS VIEW */}
        <div className="pm-view pm-view-projects" aria-label="Projects overview">
          <div className="power-vitals-list-head">8 main projects (status + CPU share + RAM by bound port/PID)</div>

          <div className="pm-projects-tiles" role="list" aria-label="Projects tiles">
            {projectCards.map((p) => (
              <div key={p.key} className="pm-project-card" role="listitem">
                <div className="pm-project-top">
                  <div className="pm-project-title-stack">
                    {p.href ? (
                      <a className="pm-project-name pm-project-name-link" href={p.href} target="_blank" rel="noreferrer">
                        {p.name}
                      </a>
                    ) : (
                      <div className="pm-project-name">{p.name}</div>
                    )}
                    {p.subtitle ? (
                      p.backendHrefResolved ? (
                        <a className="pm-project-sub pm-project-sub-link" href={p.backendHrefResolved} target="_blank" rel="noreferrer">
                          {p.subtitle}
                        </a>
                      ) : (
                        <div className="pm-project-sub">{p.subtitle}</div>
                      )
                    ) : null}
                  </div>

                  <div
                    className={p.up ? "pm-project-status pm-project-status-ok" : "pm-project-status pm-project-status-bad"}
                    title={p.portsLabel}
                  >
                    <span className="pm-project-dot" />
                    {p.up ? "Up" : "Down"}
                  </div>
                </div>

                <div className="pm-project-health-row">
                  <span className={p.requiredUpCount === p.requiredCount ? "pm-project-health-pill pm-project-health-pill-ok" : "pm-project-health-pill pm-project-health-pill-bad"}>
                    required {p.requiredUpCount}/{p.requiredCount}
                  </span>
                  <span className="pm-project-health-pill">listening {p.listeningCount}/{p.services.length}</span>
                  <span className={p.publicCount > 0 ? "pm-project-health-pill pm-project-health-pill-warn" : "pm-project-health-pill"}>
                    public {p.publicCount}
                  </span>
                </div>

                <div className="pm-project-metrics">
                  <div className="pm-project-metric">
                    <div className="pm-project-metric-label">CPU</div>
                    <div className="pm-project-metric-value">{fmtPercent(p.cpuSharePercent)}</div>
                    <div className="pm-project-metric-sub">sampled process share</div>
                    <div className="pm-project-metric-bar">
                      <span style={{ width: `${p.cpuBarPercent}%` }} />
                    </div>
                  </div>
                  <div className="pm-project-metric">
                    <div className="pm-project-metric-label">RAM</div>
                    <div className="pm-project-metric-value">{fmtSizeFromMb(p.memoryMb)}</div>
                    <div className="pm-project-metric-sub">aggregate service memory</div>
                    <div className="pm-project-metric-bar">
                      <span style={{ width: `${p.memoryBarPercent}%` }} />
                    </div>
                  </div>
                </div>

                {p.missingRequired.length > 0 ? (
                  <div className="pm-project-missing">Missing required: {p.missingRequired.join(", ")}</div>
                ) : null}

                <div className="pm-project-services-text" aria-label="Per-service ports and process IDs">
                  {p.services.map((svc) => (
                    <div
                      key={`${p.key}-${svc.label}-${svc.port}`}
                      className={svc.isListening ? "pm-project-service-line" : "pm-project-service-line pm-project-service-line-down"}
                    >
                      {svc.label}:{svc.port}
                      {typeof svc.pid === "number" ? ` #${svc.pid}` : ""}
                      {svc.isPublic ? " (public)" : ""}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="pm-projects-list" role="list" aria-label="Projects list">
            {projectCards.map((p) => (
              <div key={p.key} className="pm-project-list-row" role="listitem">
                <div className="pm-project-list-name">
                  {p.href ? (
                    <a className="pm-project-list-title pm-project-list-title-link" href={p.href} target="_blank" rel="noreferrer">
                      {p.name}
                    </a>
                  ) : (
                    <div className="pm-project-list-title">{p.name}</div>
                  )}
                  {p.subtitle ? (
                    p.backendHrefResolved ? (
                      <a className="pm-project-list-backend pm-project-list-backend-link" href={p.backendHrefResolved} target="_blank" rel="noreferrer">
                        {p.subtitle}
                      </a>
                    ) : (
                      <div className="pm-project-list-backend">{p.subtitle}</div>
                    )
                  ) : null}
                  <div className="pm-project-list-sub">
                    required {p.requiredUpCount}/{p.requiredCount} · public {p.publicCount}
                  </div>
                </div>

                <div className="pm-project-list-metric">
                  <div className="pm-project-list-metric-value">{fmtPercent(p.cpuSharePercent)}</div>
                  <div className="pm-project-list-metric-label">CPU share</div>
                </div>

                <div className="pm-project-list-metric">
                  <div className="pm-project-list-metric-value">{fmtSizeFromMb(p.memoryMb)}</div>
                  <div className="pm-project-list-metric-label">RAM</div>
                </div>

                <div className="pm-project-list-status">
                  <div className={p.up ? "pm-project-status pm-project-status-ok" : "pm-project-status pm-project-status-bad"}>
                    <span className="pm-project-dot" />
                    {p.up ? "Up" : "Down"}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="power-vitals-foot">
            Ports seen in UI: local {portsLocal.length}, public {portsPublic.length}. ({portsDebug}) Tip: CPU/RAM are derived by matching
            the project’s local ports to a PID, then looking up that PID in the vitals list. If a PID isn’t in the
            current top vitals sample, you’ll see “—”.
          </div>
        </div>

        {/* PROCESSES VIEW */}
        <div className="pm-view pm-view-processes" aria-label="Processes overview">
          <div className="power-vitals-list-head">
            Process load ranking (CPU share across observed processes, target total 100%)
          </div>

          {rows.length ? (
            <div className="power-vitals-list" role="list" aria-label="Top VPS process load">
              {rows.map((row) => (
                <div key={`${row.name}-${row.pid ?? "other"}`} className="power-vitals-row" role="listitem">
                  <div className="power-vitals-row-name">
                    <span className="power-vitals-row-proc">{row.name}</span>
                    <span className="power-vitals-row-pid">{row.pid ? `pid ${row.pid}` : "aggregated"}</span>
                  </div>
                  <div className="power-vitals-row-metric">
                    <span className="power-vitals-row-metric-label">Load</span>
                    <span className="power-vitals-row-metric-value">{fmtPercent(row.cpuSharePercent)}</span>
                  </div>
                  <div className="power-vitals-row-metric">
                    <span className="power-vitals-row-metric-label">CPU cap</span>
                    <span className="power-vitals-row-metric-value">{fmtPercent(row.cpuCapacityPercent)}</span>
                  </div>
                  <div className="power-vitals-row-metric">
                    <span className="power-vitals-row-metric-label">RAM</span>
                    <span className="power-vitals-row-metric-value">
                      {fmtSizeFromMb(row.memoryMb)} ({fmtPercent(row.memoryCapacityPercent)})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="power-vitals-empty">No process vitals in this snapshot yet. Run a fresh host report to populate.</div>
          )}

          <div className="power-vitals-foot">
            Sampled processes: {typeof d.vitalsSampledCount === "number" ? d.vitalsSampledCount : "—"} {" · "}
            CPU share sum: {fmtPercent(d.vitalsCpuShareTotalPercent)}
          </div>
        </div>
      </Box>
    </section>
  );
}

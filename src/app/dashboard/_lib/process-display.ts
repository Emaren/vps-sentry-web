import { MAIN_PROJECTS } from "./project-catalog";

export type ProcessDisplayInput = {
  pid: number | null;
  rawName: string;
  label?: string | null;
  unit?: string | null;
  exe?: string | null;
  cmdline?: string | null;
  cwd?: string | null;
  ports?: number[] | null;
  project?: string | null;
  projectLabel?: string | null;
  serviceKind?: string | null;
  isOther?: boolean;
};

export type ProcessDisplayOutput = {
  friendlyName: string;
  secondaryText: string;
  detailTitle: string | null;
  ports: number[];
  project: string | null;
  projectLabel: string | null;
  serviceKind: string | null;
};

type ProjectServiceMatch = {
  key: string;
  name: string;
  serviceLabel: string;
};

const PROJECT_INDEX = new Map(MAIN_PROJECTS.map((project) => [project.key, project]));
const PORT_INDEX = new Map<number, ProjectServiceMatch>();

for (const project of MAIN_PROJECTS) {
  for (const service of project.services) {
    if (!PORT_INDEX.has(service.port)) {
      PORT_INDEX.set(service.port, {
        key: project.key,
        name: project.name,
        serviceLabel: service.label,
      });
    }
  }
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function slugify(value: string | null | undefined): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePorts(values: number[] | null | undefined): number[] {
  const deduped = new Set<number>();
  for (const value of values ?? []) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const port = Math.trunc(value);
    if (port <= 0) continue;
    deduped.add(port);
  }
  return Array.from(deduped).sort((a, b) => a - b);
}

function formatPortsSuffix(ports: number[]): string {
  if (!ports.length) return "";
  if (ports.length === 1) return ` :${ports[0]}`;
  if (ports.length === 2) return ` :${ports[0]}, :${ports[1]}`;
  return ` :${ports[0]} +${ports.length - 1}`;
}

function cleanUnitBase(unit: string | null | undefined): string {
  const trimmed = normalizeText(unit).replace(/\.service$/i, "");
  if (!trimmed) return "";
  return trimmed.split("@", 1)[0]?.replace(/_/g, "-") ?? "";
}

function inferProjectMatch(input: ProcessDisplayInput, ports: number[]): { key: string; name: string } | null {
  const explicitKey = slugify(input.project);
  if (explicitKey) {
    const known = PROJECT_INDEX.get(explicitKey);
    return {
      key: explicitKey,
      name: normalizeText(input.projectLabel) || known?.name || explicitKey,
    };
  }

  for (const port of ports) {
    const match = PORT_INDEX.get(port);
    if (match) {
      return { key: match.key, name: match.name };
    }
  }

  const haystack = [
    input.unit,
    input.exe,
    input.cmdline,
    input.cwd,
    input.rawName,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

  for (const project of MAIN_PROJECTS) {
    const key = project.key.toLowerCase();
    if (key.length >= 4 && new RegExp(`(^|[^a-z0-9])${key}([^a-z0-9]|$)`).test(haystack)) {
      return { key: project.key, name: project.name };
    }

    const projectSlug = slugify(project.name.replace(/\bapi\b/gi, ""));
    if (projectSlug.length >= 4 && new RegExp(`(^|[^a-z0-9])${projectSlug}([^a-z0-9]|$)`).test(haystack)) {
      return { key: project.key, name: project.name };
    }
  }

  return null;
}

function inferServiceKind(input: ProcessDisplayInput, ports: number[]): string | null {
  const explicit = normalizeText(input.serviceKind);
  if (explicit) return explicit;

  for (const port of ports) {
    const match = PORT_INDEX.get(port);
    if (match?.serviceLabel) return match.serviceLabel;
  }

  const unitBase = cleanUnitBase(input.unit).toLowerCase();
  const text = [
    input.rawName,
    unitBase,
    input.exe,
    input.cmdline,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (unitBase.includes("chat-api") || /\bchat[-_ ]api\b/.test(text)) return "chat-api";
  if (unitBase.includes("ops-worker") || /\bops[-_ ]worker\b/.test(text)) return "ops-worker";
  if (unitBase.includes("worker") || /\b(worker|celery|queue)\b/.test(text)) return "worker";
  if (unitBase.includes("landing")) return "landing";
  if (unitBase.includes("indexer") || /\bindexer\b/.test(text)) return "indexer";
  if (/\btokenchaind\b/.test(text)) return "node";
  if (/\b(next-server|next)\b/.test(text) || text.includes("/.next/") || text.includes(".next/")) return "web";
  if (/\b(uvicorn|gunicorn|fastapi|flask|hypercorn|daphne)\b/.test(text)) return "api";
  if (unitBase.includes("api")) return "api";
  if (unitBase.includes("web")) return "web";

  for (const port of ports) {
    if (port === 26656) return "node";
    if (port >= 3300 && port <= 3499) return "api";
    if (port >= 3000 && port <= 3199) return "web";
  }

  return null;
}

function inferTechLabel(input: ProcessDisplayInput, serviceKind: string | null): string | null {
  const text = [
    input.rawName,
    input.unit,
    input.exe,
    input.cmdline,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (text.includes("qemu-ga") || text.includes("qemu guest agent")) return "QEMU guest agent";
  if (/\btokenchaind\b/.test(text)) return "TokenChain node";
  if (/\b(next-server|next)\b/.test(text) || text.includes("/.next/") || text.includes(".next/")) return "Next.js app";
  if (/\buvicorn\b/.test(text)) return "Uvicorn app";
  if (/\b(gunicorn|fastapi|flask|hypercorn|daphne)\b/.test(text)) return "Python API";
  if (serviceKind === "ops-worker") return "Ops worker";
  if (serviceKind === "worker") return "Worker service";
  return null;
}

function usefulUnitLabel(unit: string | null | undefined, rawName: string): string | null {
  const base = cleanUnitBase(unit);
  if (!base) return null;

  const generic = new Set([
    "app",
    "bash",
    "bun",
    "gunicorn",
    "next",
    "next-server",
    "node",
    "npm",
    "process",
    "python",
    "python3",
    "sh",
    "uvicorn",
  ]);

  const unitSlug = slugify(base);
  if (!unitSlug || generic.has(unitSlug) || unitSlug === slugify(rawName)) return null;
  return base;
}

function friendlyBaseForProject(project: { key: string; name: string }, serviceKind: string | null): string {
  if (!serviceKind) return project.key;
  if (["web", "api", "chat-api", "landing", "ops-worker", "worker", "indexer"].includes(serviceKind)) {
    return `${project.key}-${serviceKind}`;
  }
  if (serviceKind === "node") return `${project.name} node`;
  return project.key;
}

function displayValue(value: string | null | undefined): string {
  const text = normalizeText(value);
  return text || "unavailable";
}

export function resolveProcessDisplay(input: ProcessDisplayInput): ProcessDisplayOutput {
  const rawName = normalizeText(input.rawName) || (input.pid ? `pid ${input.pid}` : "process");
  const ports = normalizePorts(input.ports);

  if (input.isOther) {
    return {
      friendlyName: rawName === "other-processes" ? "Other processes" : rawName,
      secondaryText: "aggregated sampled processes",
      detailTitle: null,
      ports,
      project: null,
      projectLabel: null,
      serviceKind: null,
    };
  }

  const project = inferProjectMatch(input, ports);
  const serviceKind = inferServiceKind(input, ports);
  const unitLabel = usefulUnitLabel(input.unit, rawName);
  const techLabel = inferTechLabel(input, serviceKind);
  const explicitLabel = normalizeText(input.label);

  let baseLabel = explicitLabel;
  if (!baseLabel) {
    if (techLabel === "QEMU guest agent" || techLabel === "TokenChain node") {
      baseLabel = techLabel;
    } else if (unitLabel) {
      baseLabel = unitLabel;
    } else if (project) {
      baseLabel = friendlyBaseForProject(project, serviceKind);
    } else if (techLabel) {
      baseLabel = techLabel;
    } else {
      baseLabel = rawName;
    }
  }

  const shouldAppendPorts =
    ports.length > 0 &&
    !/:\d/.test(baseLabel) &&
    serviceKind !== "node" &&
    baseLabel !== "QEMU guest agent" &&
    baseLabel !== "TokenChain node";

  const friendlyName = shouldAppendPorts ? `${baseLabel}${formatPortsSuffix(ports)}` : baseLabel;
  const secondaryText = input.pid ? `pid ${input.pid} · ${rawName}` : rawName;

  const detailLines = [
    friendlyName,
    input.pid ? `PID: ${input.pid}` : "PID: unavailable",
    `Raw process: ${rawName}`,
    `Ports: ${ports.length ? ports.map((port) => `:${port}`).join(", ") : "unavailable"}`,
    `Service unit: ${displayValue(input.unit)}`,
    `Working directory: ${displayValue(input.cwd)}`,
    `Executable: ${displayValue(input.exe)}`,
    `Command: ${displayValue(input.cmdline)}`,
  ];

  if (project) {
    detailLines.splice(3, 0, `Project: ${project.name} (${project.key})`);
  }

  return {
    friendlyName,
    secondaryText,
    detailTitle: detailLines.join("\n"),
    ports,
    project: project?.key ?? null,
    projectLabel: project?.name ?? null,
    serviceKind,
  };
}

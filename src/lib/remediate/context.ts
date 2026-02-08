type JsonRecord = Record<string, unknown>;

export type RemediationPort = {
  host: string;
  port: number;
  proto: "tcp" | "udp";
  proc?: string;
  pid?: number;
};

export type RemediationContext = {
  unexpectedPublicPorts: RemediationPort[];
  publicPorts: RemediationPort[];
};

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === "object" ? (v as JsonRecord) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^[0-9]+$/.test(v.trim())) return Number(v);
  return null;
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function toProto(v: unknown): "tcp" | "udp" | null {
  const t = asText(v).toLowerCase();
  if (t === "tcp" || t === "udp") return t;
  return null;
}

function toPort(v: unknown): number | null {
  const n = asNumber(v);
  if (!n) return null;
  if (n < 1 || n > 65535) return null;
  return n;
}

function parsePortRecords(input: unknown): RemediationPort[] {
  const out: RemediationPort[] = [];
  for (const item of asArray(input)) {
    const rec = asRecord(item);
    if (!rec) continue;

    const proto = toProto(rec.proto);
    const port = toPort(rec.port);
    if (!proto || !port) continue;

    const host = asText(rec.host) || "0.0.0.0";
    const proc = asText(rec.proc) || undefined;
    const pid = asNumber(rec.pid) ?? undefined;

    out.push({ host, port, proto, proc, pid });
  }
  return out;
}

function parseExpectedPorts(status: JsonRecord): Set<string> {
  const out = new Set<string>();
  for (const item of asArray(status.expected_public_ports)) {
    const t = asText(item).toLowerCase();
    const m = t.match(/^(tcp|udp):([0-9]{1,5})$/);
    if (!m) continue;
    const port = Number(m[2]);
    if (port < 1 || port > 65535) continue;
    out.add(`${m[1]}:${port}`);
  }
  return out;
}

function dedupePorts(items: RemediationPort[]): RemediationPort[] {
  const seen = new Set<string>();
  const out: RemediationPort[] = [];
  for (const p of items) {
    const key = `${p.proto}:${p.port}:${p.host}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function deriveRemediationContextFromStatus(status: JsonRecord): RemediationContext {
  const publicPorts = parsePortRecords(status.ports_public);
  const expected = parseExpectedPorts(status);

  // Prefer explicit unexpected ports if the agent emits them.
  let unexpectedPublicPorts = parsePortRecords(status.ports_public_unexpected);

  if (!unexpectedPublicPorts.length && expected.size) {
    unexpectedPublicPorts = publicPorts.filter((p) => !expected.has(`${p.proto}:${p.port}`));
  }

  // Fall back to count-based hint when explicit lists are absent.
  if (!unexpectedPublicPorts.length) {
    const hintedUnexpected = asNumber(status.unexpected_public_ports_count) ?? 0;
    if (hintedUnexpected > 0) {
      unexpectedPublicPorts = publicPorts.slice(0, hintedUnexpected);
    }
  }

  return {
    publicPorts: dedupePorts(publicPorts),
    unexpectedPublicPorts: dedupePorts(unexpectedPublicPorts),
  };
}


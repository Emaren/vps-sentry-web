export type CounterstrikeMode = "analyze" | "dry-run" | "execute";

export type CounterstrikePlaybook = {
  id: string;
  label: string;
  title: string;
  description: string;
};

export const COUNTERSTRIKE_PLAYBOOKS: CounterstrikePlaybook[] = [
  {
    id: "zap-01-miner-persistence-purge",
    label: "Zap! #1",
    title: "Miner Persistence Purge",
    description:
      "Kill suspicious miner-style processes in writable paths, quarantine binaries, and scrub matching cron persistence.",
  },
];

export const DEFAULT_COUNTERSTRIKE_PLAYBOOK = COUNTERSTRIKE_PLAYBOOKS[0];

export function getCounterstrikePlaybook(id: string | null | undefined): CounterstrikePlaybook | null {
  if (!id) return null;
  const normalized = id.trim().toLowerCase();
  return COUNTERSTRIKE_PLAYBOOKS.find((playbook) => playbook.id === normalized) ?? null;
}

export function normalizeCounterstrikeMode(raw: unknown): CounterstrikeMode {
  if (raw === "execute" || raw === "dry-run" || raw === "analyze") {
    return raw;
  }
  return "analyze";
}

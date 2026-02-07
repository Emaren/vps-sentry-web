import type { SecurityPosture } from "@/lib/security-posture";
import type { RemediationAction } from "./actions";
import type { RemediationContext } from "./context";

export type ContainmentProfile = "standard" | "elevated" | "critical";

export type ContainmentKit = {
  profile: ContainmentProfile;
  headline: string;
  triage: string[];
  contain: string[];
  verify: string[];
  recover: string[];
};

type BuildContainmentKitInput = {
  hostName: string;
  hostId: string;
  posture: SecurityPosture;
  actions: RemediationAction[];
  context: RemediationContext;
};

const PRIORITY_WEIGHT: Record<RemediationAction["priority"], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

function rankActions(actions: RemediationAction[]): RemediationAction[] {
  return [...actions].sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority];
    const pb = PRIORITY_WEIGHT[b.priority];
    if (pa !== pb) return pa - pb;
    if (a.risk !== b.risk) {
      if (a.risk === "high") return -1;
      if (b.risk === "high") return 1;
      if (a.risk === "medium") return -1;
      if (b.risk === "medium") return 1;
    }
    return a.title.localeCompare(b.title);
  });
}

function unique<T>(items: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function selectActionLimit(profile: ContainmentProfile): number {
  if (profile === "critical") return 3;
  if (profile === "elevated") return 2;
  return 1;
}

function profileFromPosture(posture: SecurityPosture): ContainmentProfile {
  if (posture.stage === "lockdown" || posture.band === "critical") return "critical";
  if (posture.stage === "contain" || posture.band === "elevated") return "elevated";
  return "standard";
}

function headlineForProfile(profile: ContainmentProfile): string {
  if (profile === "critical") return "Critical containment runbook: isolate fast, validate access, preserve evidence.";
  if (profile === "elevated") return "Elevated containment runbook: apply targeted controls, verify exposure closed.";
  return "Standard hardening runbook: verify drift and tighten posture safely.";
}

function triageCommands(hostName: string, hostId: string): string[] {
  return [
    `# Triage snapshot for ${hostName} (${hostId})`,
    "date -u",
    "hostnamectl --static || hostname",
    "uptime",
    "sudo vps-sentry --format text",
    "sudo ss -lntup",
    "sudo journalctl -u vps-sentry.service -n 120 --no-pager",
  ];
}

function containCommands(
  actions: RemediationAction[],
  context: RemediationContext,
  profile: ContainmentProfile
): string[] {
  const ranked = rankActions(actions).slice(0, selectActionLimit(profile));
  const lines: string[] = [];

  if (!ranked.length) {
    return [
      "# No mapped action set. Collect forensics first.",
      "sudo vps-sentry --format text",
      "sudo cp -a /var/lib/vps-sentry /root/vps-sentry-forensics-$(date +%Y%m%d-%H%M%S)",
    ];
  }

  for (const action of ranked) {
    lines.push(`# Action: ${action.title} (${action.id})`);
    lines.push(...action.commands);
    lines.push("");
  }

  const unexpectedPorts = context.unexpectedPublicPorts
    .map((p) => `${p.port}/${p.proto}`)
    .filter(Boolean);
  for (const target of unique(unexpectedPorts)) {
    lines.push(`# Optional explicit quarantine for ${target}`);
    lines.push(`sudo ufw deny ${target}`);
  }

  return lines.filter((line, i, arr) => !(line === "" && arr[i - 1] === ""));
}

function verifyCommands(context: RemediationContext): string[] {
  const portPattern = unique(context.unexpectedPublicPorts.map((p) => p.port))
    .slice(0, 6)
    .join("|");

  const verifyPorts = portPattern
    ? `sudo ss -lntup | grep -E ':(?:${portPattern})\\\\b' || echo 'No unexpected listener found'`
    : "sudo ss -lntup";

  return [
    "# Verify containment impact and service health",
    verifyPorts,
    "sudo ufw status verbose",
    "sudo nft list ruleset | sed -n '1,220p'",
    "sudo systemctl is-active ssh || sudo systemctl is-active sshd",
    "sudo vps-sentry --format text",
  ];
}

function recoverCommands(actions: RemediationAction[]): string[] {
  const rollback = unique(
    actions.flatMap((a) => (a.rollbackNotes ?? []).map((line) => `# ${line}`))
  );

  return [
    "# Recovery and baseline hygiene",
    ...rollback,
    "sudo vps-sentry --format text",
    "# If changes are expected and verified, accept the new baseline:",
    "sudo vps-sentry --accept-baseline",
  ];
}

export function buildContainmentKit(input: BuildContainmentKitInput): ContainmentKit {
  const profile = profileFromPosture(input.posture);

  return {
    profile,
    headline: headlineForProfile(profile),
    triage: triageCommands(input.hostName, input.hostId),
    contain: containCommands(input.actions, input.context, profile),
    verify: verifyCommands(input.context),
    recover: recoverCommands(input.actions),
  };
}

function section(title: string, commands: string[]): string {
  return [`# ${title}`, ...commands, ""].join("\n");
}

export function renderContainmentKitScript(kit: ContainmentKit): string {
  return [
    "# VPS Sentry Emergency Containment Kit",
    `# Profile: ${kit.profile}`,
    `# ${kit.headline}`,
    "",
    section("1) Triage", kit.triage),
    section("2) Contain", kit.contain),
    section("3) Verify", kit.verify),
    section("4) Recover", kit.recover),
  ].join("\n");
}

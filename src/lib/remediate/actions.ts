import type { IncidentSignal } from "@/lib/incident-signals";
import type { RemediationContext } from "./context";

export type RemediationPriority = "P0" | "P1" | "P2";
export type RemediationRisk = "low" | "medium" | "high";

export type RemediationAction = {
  id: string;
  priority: RemediationPriority;
  risk: RemediationRisk;
  title: string;
  why: string;
  sourceCodes: string[];
  commands: string[];
  rollbackNotes?: string[];
  requiresConfirm: boolean;
  confirmPhrase: string;
};

function hasCode(signals: IncidentSignal[], code: string): boolean {
  return signals.some((s) => s.code === code);
}

function topSignalCodes(signals: IncidentSignal[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of signals) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    out.push(s.code);
  }
  return out;
}

function withConfirm(action: Omit<RemediationAction, "requiresConfirm" | "confirmPhrase">): RemediationAction {
  return {
    ...action,
    requiresConfirm: true,
    confirmPhrase: `EXECUTE ${action.id}`,
  };
}

function firewallAndAccessActions(signals: IncidentSignal[]): RemediationAction[] {
  if (!hasCode(signals, "config_tamper") && !hasCode(signals, "firewall_drift")) return [];

  return [
    withConfirm({
      id: "lockdown-access-surface",
      priority: "P0",
      risk: "medium",
      title: "Lock Down SSH + Firewall Surface",
      why: "Critical config drift was detected in sensitive access-control paths.",
      sourceCodes: ["config_tamper", "firewall_drift"],
      commands: [
        "sudo cp -a /etc/ssh/sshd_config /root/sshd_config.backup.$(date +%Y%m%d-%H%M%S)",
        "sudo cp -a /etc/sudoers /root/sudoers.backup.$(date +%Y%m%d-%H%M%S)",
        "sudo ls -la /etc/ssh/sshd_config.d /etc/sudoers.d /etc/systemd/system /etc/ufw",
        "sudo journalctl -u ssh -n 200 --no-pager | grep -Ei 'failed password|invalid user|accepted'",
        "sudo ufw status verbose",
        "sudo nft list ruleset | sed -n '1,220p'",
      ],
      rollbackNotes: [
        "Restore backed up sshd/sudoers files if hardening changes break access.",
        "Use a second SSH session before reloading sshd so you cannot lock yourself out.",
      ],
    }),
  ];
}

function unexpectedPortActions(signals: IncidentSignal[], context: RemediationContext): RemediationAction[] {
  if (!hasCode(signals, "unexpected_public_ports")) return [];

  const candidates = context.unexpectedPublicPorts.slice(0, 3);
  const targets = candidates.length
    ? candidates.map((p) => `${p.proto}:${p.port}${p.proc ? ` (${p.proc})` : ""}`).join(", ")
    : "unexpected listener(s)";

  const grepPattern = candidates.length
    ? candidates.map((p) => p.port).join("|")
    : "[0-9]+";

  const blockRules = candidates.length
    ? candidates.map((p) => `sudo ufw deny ${p.port}/${p.proto}`)
    : ["# No concrete port values in latest snapshot; identify first, then deny explicitly."];

  return [
    withConfirm({
      id: "quarantine-unexpected-listener",
      priority: "P0",
      risk: "high",
      title: "Quarantine Unexpected Public Listener",
      why: `Unexpected public exposure detected: ${targets}.`,
      sourceCodes: ["unexpected_public_ports"],
      commands: [
        `sudo ss -lntup | grep -E ':(?:${grepPattern})\\\\b' || true`,
        ...blockRules,
        "sudo ufw status numbered",
        `sudo ss -lntup | grep -E ':(?:${grepPattern})\\\\b' || true`,
        "sudo journalctl -u vps-sentry.service -n 120 --no-pager",
      ],
      rollbackNotes: [
        "If legitimate traffic breaks, remove the deny rule with `sudo ufw delete deny <PORT>/<PROTO>`.",
      ],
    }),
  ];
}

function sshNoiseActions(signals: IncidentSignal[]): RemediationAction[] {
  if (!hasCode(signals, "ssh_failed_password") && !hasCode(signals, "ssh_invalid_user")) return [];

  return [
    withConfirm({
      id: "harden-ssh-auth",
      priority: "P1",
      risk: "medium",
      title: "Harden SSH Authentication",
      why: "SSH brute-force or invalid-user probes were detected.",
      sourceCodes: ["ssh_failed_password", "ssh_invalid_user"],
      commands: [
        "sudo grep -nE '^(PasswordAuthentication|PermitRootLogin|PubkeyAuthentication|AllowUsers)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null || true",
        "sudo journalctl -u ssh -n 300 --no-pager | grep -Ei 'failed password|invalid user' | tail -n 80",
        "sudo ufw limit 22/tcp",
        "sudo systemctl reload ssh || sudo systemctl reload sshd",
      ],
      rollbackNotes: [
        "Confirm key-based login works from another terminal before disabling password auth.",
      ],
    }),
  ];
}

function driftActions(signals: IncidentSignal[]): RemediationAction[] {
  if (!hasCode(signals, "package_drift") && !hasCode(signals, "account_drift")) return [];

  return [
    withConfirm({
      id: "verify-system-drift",
      priority: "P2",
      risk: "low",
      title: "Verify Package/User Drift Is Expected",
      why: "System state changed and should be confirmed as planned maintenance.",
      sourceCodes: ["package_drift", "account_drift"],
      commands: [
        "grep -E ' install | upgrade | remove ' /var/log/apt/history.log | tail -n 120",
        "sudo getent passwd | tail -n 40",
        "sudo systemctl list-unit-files --type=service --no-pager | grep -Ei 'enabled|generated'",
        "sudo vps-sentry --format text",
      ],
      rollbackNotes: [
        "If drift is expected after maintenance, accept baseline to prevent repeated noise.",
      ],
    }),
  ];
}

export function buildRemediationActions(
  signals: IncidentSignal[],
  context: RemediationContext = { unexpectedPublicPorts: [], publicPorts: [] }
): RemediationAction[] {
  if (!signals.length) return [];

  const actions = [
    ...firewallAndAccessActions(signals),
    ...unexpectedPortActions(signals, context),
    ...sshNoiseActions(signals),
    ...driftActions(signals),
  ];

  if (!actions.length) {
    return [
      withConfirm({
        id: "collect-forensics-first",
        priority: "P2",
        risk: "low",
        title: "Collect Forensics Snapshot",
        why: "Signals exist but do not map to a known playbook yet.",
        sourceCodes: topSignalCodes(signals),
        commands: [
          "sudo vps-sentry --format text",
          "sudo cp -a /var/lib/vps-sentry /root/vps-sentry-forensics-$(date +%Y%m%d-%H%M%S)",
          "sudo journalctl -u vps-sentry.service -n 200 --no-pager",
        ],
      }),
    ];
  }

  return actions;
}

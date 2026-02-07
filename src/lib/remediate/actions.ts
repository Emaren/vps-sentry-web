import type { IncidentSignal } from "@/lib/incident-signals";

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

function firewallAndAccessActions(signals: IncidentSignal[]): RemediationAction[] {
  if (!hasCode(signals, "config_tamper") && !hasCode(signals, "firewall_drift")) return [];

  return [
    {
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
    },
  ];
}

function unexpectedPortActions(signals: IncidentSignal[]): RemediationAction[] {
  if (!hasCode(signals, "unexpected_public_ports")) return [];

  return [
    {
      id: "quarantine-unexpected-listener",
      priority: "P0",
      risk: "high",
      title: "Quarantine Unexpected Public Listener",
      why: "An unexpected public port was observed and may expose a malicious process.",
      sourceCodes: ["unexpected_public_ports"],
      commands: [
        "sudo ss -lntup",
        "sudo lsof -i -P -n | grep -E 'LISTEN|UDP' || true",
        "sudo systemctl list-units --type=service --state=running --no-pager",
        "# After identifying suspicious PID/service:",
        "sudo systemctl stop <SUSPECT_SERVICE>",
        "sudo ufw deny <PORT>/<tcp|udp>",
      ],
      rollbackNotes: [
        "If legitimate traffic breaks, remove the temporary firewall deny rule and restart the expected service.",
      ],
    },
  ];
}

function sshNoiseActions(signals: IncidentSignal[]): RemediationAction[] {
  if (!hasCode(signals, "ssh_failed_password") && !hasCode(signals, "ssh_invalid_user")) return [];

  return [
    {
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
    },
  ];
}

function driftActions(signals: IncidentSignal[]): RemediationAction[] {
  if (!hasCode(signals, "package_drift") && !hasCode(signals, "account_drift")) return [];

  return [
    {
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
    },
  ];
}

export function buildRemediationActions(signals: IncidentSignal[]): RemediationAction[] {
  if (!signals.length) return [];

  const actions = [
    ...firewallAndAccessActions(signals),
    ...unexpectedPortActions(signals),
    ...sshNoiseActions(signals),
    ...driftActions(signals),
  ];

  if (!actions.length) {
    return [
      {
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
      },
    ];
  }

  return actions;
}

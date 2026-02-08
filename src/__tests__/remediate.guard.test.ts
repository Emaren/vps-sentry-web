import { describe, expect, it } from "vitest";
import { validateRemediationCommands } from "../lib/remediate/guard";

describe("remediation command guard", () => {
  it("accepts known-safe command blocks", () => {
    const issues = validateRemediationCommands([
      "sudo ss -lntup",
      "sudo ufw status numbered",
      "grep -E ' install | upgrade | remove ' /var/log/apt/history.log | tail -n 120",
    ]);
    expect(issues).toHaveLength(0);
  });

  it("blocks dangerous commands", () => {
    const issues = validateRemediationCommands([
      "sudo rm -rf /",
    ]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.reason).toContain("blocked_pattern");
  });

  it("blocks non-allowlisted commands when allowlist is enabled", () => {
    const issues = validateRemediationCommands([
      "cat /etc/passwd",
    ]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.reason).toBe("not_allowlisted");
  });
});

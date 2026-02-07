import { describe, expect, it } from "vitest";
import { executeRemediationCommands, formatExecutionForLog } from "../lib/remediate/runner";

describe("remediation runner", () => {
  it("skips comments and executes shell commands in order", async () => {
    const result = await executeRemediationCommands([
      "# comment",
      "echo runner_ok",
    ]);

    expect(result.ok).toBe(true);
    expect(result.results[0]?.skipped).toBe(true);
    expect(result.results[1]?.stdout).toContain("runner_ok");
  });

  it("stops on command failure", async () => {
    const result = await executeRemediationCommands([
      "echo first",
      "bash -lc 'exit 4'",
      "echo should_not_run",
    ]);

    expect(result.ok).toBe(false);
    expect(result.results.some((r) => r.exitCode === 4)).toBe(true);
    expect(result.results.some((r) => r.command.includes("should_not_run"))).toBe(false);

    const rendered = formatExecutionForLog(result);
    expect(rendered).toContain("ok=false");
    expect(rendered).toContain("exit=4");
  });
});

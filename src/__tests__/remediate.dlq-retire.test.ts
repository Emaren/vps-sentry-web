import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  remediationRun: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const runnerMock = vi.hoisted(() => ({
  executeRemediationCommands: vi.fn(),
  formatExecutionForLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/remediate/runner", () => runnerMock);

import { retireDeadLetterRuns } from "@/lib/remediate/queue";

function staleDlqPayload() {
  return JSON.stringify({
    mode: "execute",
    actionId: "action_ssh",
    commands: ["true"],
    sourceCodes: ["baseline-drift"],
    rollbackNotes: [],
    queue: {
      dlq: true,
      dlqReason: "auto_rolled_back",
      attempts: 1,
      maxAttempts: 3,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.remediationRun.update.mockReturnValue({ op: "update" });
  prismaMock.auditLog.create.mockReturnValue({ op: "audit" });
  prismaMock.$transaction.mockResolvedValue([{ id: "run_1" }, { id: "audit_1" }]);
});

describe("retireDeadLetterRuns", () => {
  it("retires stale DLQ metadata without replaying remediation commands", async () => {
    prismaMock.remediationRun.findMany.mockResolvedValue([
      {
        id: "run_1",
        hostId: "host_1",
        actionId: "action_ssh",
        paramsJson: staleDlqPayload(),
        finishedAt: new Date("2026-08-18T14:15:26.000Z"),
        error: "Execution failed and moved to DLQ.",
        action: { key: "harden-ssh-auth" },
      },
    ]);

    const result = await retireDeadLetterRuns({
      limit: 20,
      minAgeMinutes: 7 * 24 * 60,
      retiredByUserId: "user_1",
      reason: "host independently verified healthy",
    });

    expect(result).toMatchObject({
      ok: true,
      retired: 1,
      skipped: 0,
      requestedLimit: 20,
      minAgeMinutes: 7 * 24 * 60,
    });
    expect(runnerMock.executeRemediationCommands).not.toHaveBeenCalled();

    const update = prismaMock.remediationRun.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "run_1" });
    expect(update.data.state).toBe("canceled");
    const payload = JSON.parse(update.data.paramsJson);
    expect(payload.queue.dlq).toBe(false);
    expect(payload.queue.dlqReason).toBe("retired");

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        hostId: "host_1",
        action: "remediate.execute.dlq_retired",
      }),
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("queries only failed DLQ entries older than the safety cutoff", async () => {
    prismaMock.remediationRun.findMany.mockResolvedValue([]);

    await retireDeadLetterRuns({
      limit: 50,
      minAgeMinutes: 60,
      reason: "reviewed",
    });

    const query = prismaMock.remediationRun.findMany.mock.calls[0][0];
    expect(query.where.state).toBe("failed");
    expect(query.where.requestedAt.lte).toBeInstanceOf(Date);
    expect(query.where.AND).toEqual([
      { paramsJson: { contains: "\"mode\":\"execute\"" } },
      { paramsJson: { contains: "\"dlq\":true" } },
    ]);
    expect(query.take).toBe(50);
    expect(runnerMock.executeRemediationCommands).not.toHaveBeenCalled();
  });
});

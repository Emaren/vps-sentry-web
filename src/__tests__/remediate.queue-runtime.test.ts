import { describe, expect, it } from "vitest";
import {
  computeNextRetryAt,
  computeRetryDelaySeconds,
  parseExecuteRunPayload,
  queueMetaIsReady,
  serializeExecuteRunPayload,
  shouldRetryAttempt,
} from "@/lib/remediate/queue-runtime";

describe("remediation queue runtime helpers", () => {
  it("parses legacy execute payloads and injects default queue meta", () => {
    const raw = JSON.stringify({
      mode: "execute",
      actionId: "harden-ssh",
      commands: ["sudo systemctl reload ssh"],
      sourceCodes: ["ssh_failed_password"],
      rollbackNotes: ["restore ssh config if needed"],
    });

    const payload = parseExecuteRunPayload(raw, { defaultMaxAttempts: 4 });
    expect(payload).not.toBeNull();
    expect(payload?.queue.attempts).toBe(0);
    expect(payload?.queue.maxAttempts).toBe(4);
    expect(payload?.queue.dlq).toBe(false);
    expect(payload?.queue.nextAttemptAt).toBeNull();
  });

  it("preserves queue metadata through serialize/parse cycle", () => {
    const payload = parseExecuteRunPayload(
      {
        mode: "execute",
        actionId: "restart-nginx",
        commands: ["sudo systemctl restart nginx"],
        sourceCodes: ["service_degraded"],
        rollbackNotes: [],
        queue: {
          attempts: 2,
          maxAttempts: 5,
          nextAttemptAt: "2026-02-08T10:00:00.000Z",
          lastAttemptAt: "2026-02-08T09:50:00.000Z",
          lastError: "command timeout",
          dlq: false,
          replayOfRunId: "run_abc",
        },
      },
      { defaultMaxAttempts: 3 }
    );
    expect(payload).not.toBeNull();

    const serialized = serializeExecuteRunPayload(payload!);
    const parsed = parseExecuteRunPayload(serialized, { defaultMaxAttempts: 3 });
    expect(parsed?.queue.attempts).toBe(2);
    expect(parsed?.queue.maxAttempts).toBe(5);
    expect(parsed?.queue.replayOfRunId).toBe("run_abc");
    expect(parsed?.queue.lastError).toBe("command timeout");
  });

  it("computes exponential retry delays and retry eligibility", () => {
    expect(computeRetryDelaySeconds(1, 15, 900)).toBe(15);
    expect(computeRetryDelaySeconds(2, 15, 900)).toBe(30);
    expect(computeRetryDelaySeconds(4, 15, 900)).toBe(120);
    expect(computeRetryDelaySeconds(10, 15, 300)).toBe(300);

    expect(shouldRetryAttempt(1, 3)).toBe(true);
    expect(shouldRetryAttempt(2, 3)).toBe(true);
    expect(shouldRetryAttempt(3, 3)).toBe(false);
  });

  it("marks queue readiness from nextAttemptAt", () => {
    const now = new Date("2026-02-08T12:00:00.000Z");
    const past = parseExecuteRunPayload(
      {
        mode: "execute",
        actionId: "a",
        commands: ["echo hi"],
        sourceCodes: [],
        rollbackNotes: [],
        queue: { nextAttemptAt: "2026-02-08T11:59:00.000Z" },
      },
      { defaultMaxAttempts: 3 }
    )!;

    const future = parseExecuteRunPayload(
      {
        mode: "execute",
        actionId: "a",
        commands: ["echo hi"],
        sourceCodes: [],
        rollbackNotes: [],
        queue: { nextAttemptAt: "2026-02-08T12:01:00.000Z" },
      },
      { defaultMaxAttempts: 3 }
    )!;

    expect(queueMetaIsReady(past.queue, now)).toBe(true);
    expect(queueMetaIsReady(future.queue, now)).toBe(false);
    expect(computeNextRetryAt(now, 30)).toBe("2026-02-08T12:00:30.000Z");
  });

  it("blocks readiness when approval is required and still pending", () => {
    const now = new Date("2026-02-08T12:00:00.000Z");
    const pending = parseExecuteRunPayload(
      {
        mode: "execute",
        actionId: "a",
        commands: ["echo hi"],
        sourceCodes: [],
        rollbackNotes: [],
        queue: {
          approval: {
            required: true,
            status: "pending",
          },
        },
      },
      { defaultMaxAttempts: 3 }
    )!;
    const approved = parseExecuteRunPayload(
      {
        mode: "execute",
        actionId: "a",
        commands: ["echo hi"],
        sourceCodes: [],
        rollbackNotes: [],
        queue: {
          approval: {
            required: true,
            status: "approved",
          },
        },
      },
      { defaultMaxAttempts: 3 }
    )!;

    expect(queueMetaIsReady(pending.queue, now)).toBe(false);
    expect(queueMetaIsReady(approved.queue, now)).toBe(true);
  });
});

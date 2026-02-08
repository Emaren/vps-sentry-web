import { describe, expect, it } from "vitest";
import {
  inspectWorkflowStepResult,
  resolveWorkflowStepInput,
} from "@/lib/ops/workflow-executor";

describe("workflow executor helpers", () => {
  it("resolves workflow steps and merges payload defaults", () => {
    const resolved = resolveWorkflowStepInput({
      workflowId: "critical-triage",
      stepId: "drain-queue",
      payload: { limit: 9 },
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.workflow.id).toBe("critical-triage");
    expect(resolved.step.id).toBe("drain-queue");
    expect(resolved.payload.limit).toBe(9);
  });

  it("returns validation errors for unknown ids", () => {
    const badWorkflow = resolveWorkflowStepInput({
      workflowId: "missing",
      stepId: "status-snapshot",
    });
    expect(badWorkflow.ok).toBe(false);
    if (badWorkflow.ok) return;
    expect(badWorkflow.status).toBe(404);

    const badStep = resolveWorkflowStepInput({
      workflowId: "critical-triage",
      stepId: "missing-step",
    });
    expect(badStep.ok).toBe(false);
    if (badStep.ok) return;
    expect(badStep.status).toBe(404);
  });

  it("interprets step result envelopes consistently", () => {
    expect(inspectWorkflowStepResult({ ok: true }).ok).toBe(true);
    expect(inspectWorkflowStepResult({ ok: false, error: "x" })).toEqual({
      ok: false,
      error: "x",
    });
    expect(inspectWorkflowStepResult({ ok: false, detail: "detail-fallback" })).toEqual({
      ok: false,
      error: "detail-fallback",
    });
    expect(inspectWorkflowStepResult(null).ok).toBe(true);
  });
});

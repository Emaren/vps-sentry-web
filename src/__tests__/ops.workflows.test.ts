import { describe, expect, it } from "vitest";
import {
  INCIDENT_WORKFLOWS,
  getIncidentWorkflowById,
  getIncidentWorkflowStepById,
} from "@/lib/ops/workflows";

describe("incident workflows catalog", () => {
  it("has unique workflow ids and complete metadata", () => {
    const seen = new Set<string>();

    for (const workflow of INCIDENT_WORKFLOWS) {
      expect(workflow.id.length).toBeGreaterThan(0);
      expect(workflow.title.length).toBeGreaterThan(0);
      expect(workflow.triggerSignals.length).toBeGreaterThan(0);
      expect(workflow.playbookRefs.length).toBeGreaterThan(0);

      expect(seen.has(workflow.id)).toBe(false);
      seen.add(workflow.id);
    }
  });

  it("enforces valid step shape by type", () => {
    for (const workflow of INCIDENT_WORKFLOWS) {
      const seenStepIds = new Set<string>();
      expect(workflow.steps.length).toBeGreaterThan(0);

      for (const step of workflow.steps) {
        expect(step.id.length).toBeGreaterThan(0);
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.description.length).toBeGreaterThan(0);

        expect(seenStepIds.has(step.id)).toBe(false);
        seenStepIds.add(step.id);

        if (step.kind === "api") {
          expect(step.action).toBeTruthy();
        } else {
          expect(step.action).toBeUndefined();
        }
      }
    }
  });

  it("resolves workflow and step ids case-insensitively", () => {
    const workflow = getIncidentWorkflowById("CRITICAL-TRIAGE");
    expect(workflow?.id).toBe("critical-triage");

    const step = workflow
      ? getIncidentWorkflowStepById(workflow, "NOTIFY-TEST")
      : null;

    expect(step?.id).toBe("notify-test");
    expect(getIncidentWorkflowById("does-not-exist")).toBeNull();
  });
});

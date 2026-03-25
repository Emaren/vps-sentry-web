import { describe, expect, it } from "vitest";
import { MAIN_PROJECTS } from "@/app/dashboard/_lib/project-catalog";

describe("project catalog", () => {
  it("tracks Traffic with both live service ports", () => {
    const project = MAIN_PROJECTS.find((entry) => entry.key === "traffic");
    expect(project).toBeDefined();
    expect(project?.href).toBe("https://traffic.tokentap.ca");
    expect(project?.services).toEqual([
      { label: "web", port: 3045, required: true },
      { label: "api", port: 3345, required: true },
    ]);
  });

  it("tracks Wallyverse with web and api ports", () => {
    const project = MAIN_PROJECTS.find((entry) => entry.key === "wallyverse");
    expect(project).toBeDefined();
    expect(project?.href).toBe("https://wallyverse.tokentap.ca");
    expect(project?.services).toEqual([
      { label: "web", port: 3110, required: true },
      { label: "api", port: 3410, required: true },
    ]);
  });
});

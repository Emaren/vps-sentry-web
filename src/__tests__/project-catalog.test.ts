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

  it("tracks AoE2DEWarWagers as a project-level volume-backed app", () => {
    const project = MAIN_PROJECTS.find((entry) => entry.key === "aoe2dewarwagers");
    expect(project).toBeDefined();
    expect(project?.services).toEqual([
      { label: "web", port: 4000, required: true },
      { label: "api", port: 4400, required: true },
    ]);
    expect(project?.storage?.vpsRoots).toContain("/var/www/AoE2DEWarWagers");
    expect(project?.storage?.contextRoots).toContain("~/projects/AoE2DEWarWagers/aoe2de-watcher");
  });

  it("tracks the new AscendAI and UseTab volume-backed services", () => {
    const ascend = MAIN_PROJECTS.find((entry) => entry.key === "ascendai");
    const useTab = MAIN_PROJECTS.find((entry) => entry.key === "usetab-ca");

    expect(ascend?.href).toBe("https://ascendai.one");
    expect(ascend?.services).toEqual([{ label: "web", port: 3070, required: true }]);
    expect(ascend?.storage?.vpsRoots).toContain("/mnt/HC_Volume_105319120/www-moved/AscendAI");

    expect(useTab?.href).toBe("https://usetab.ca");
    expect(useTab?.services).toEqual([{ label: "web", port: 3080, required: true }]);
    expect(useTab?.storage?.vpsRoots).toContain("/mnt/HC_Volume_105319120/www-moved/UseTab");
  });

  it("keeps CreditChain visible without pretending the chain service is deployed", () => {
    const project = MAIN_PROJECTS.find((entry) => entry.key === "creditchain");
    expect(project).toBeDefined();
    expect(project?.state).toBe("dormant");
    expect(project?.href).toBe("https://chain.usetab.ca");
    expect(project?.backendHref).toBe("https://chain.ascendai.one");
    expect(project?.services).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { inferNotifyKindFromTarget } from "@/lib/notify";
import { compactStatusForBundle } from "@/lib/support/bundle";

describe("step4 helper behavior", () => {
  it("infers notify kind from target", () => {
    expect(inferNotifyKindFromTarget("ops@example.com")).toBe("EMAIL");
    expect(inferNotifyKindFromTarget("https://hooks.example.com/path")).toBe("WEBHOOK");
    expect(inferNotifyKindFromTarget("not-a-target")).toBe(null);
  });

  it("compacts status payload for support bundles", () => {
    const compact = compactStatusForBundle({
      host: "node-1",
      version: "1.2.3",
      alerts_count: 4,
      public_ports_count: 2,
      alerts: [{ title: "a" }, { title: "b" }],
      ports_public: [{ port: 22 }],
      sensitive: "drop-me",
    });

    expect(compact?.host).toBe("node-1");
    expect(compact?.alerts_count).toBe(4);
    expect(compact?.sensitive).toBeUndefined();
    expect(Array.isArray(compact?.alerts)).toBe(true);
  });
});

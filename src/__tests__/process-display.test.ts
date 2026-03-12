import { describe, expect, it } from "vitest";
import { resolveProcessDisplay } from "../app/dashboard/_lib/process-display";

describe("resolveProcessDisplay", () => {
  it("derives a project web label from cwd and listening port", () => {
    const out = resolveProcessDisplay({
      pid: 3431042,
      rawName: "next-server",
      cwd: "/var/www/AoE2HDBets/apps/web",
      ports: [3030],
    });

    expect(out.friendlyName).toBe("aoe2hdbets-web :3030");
    expect(out.secondaryText).toBe("pid 3431042 · next-server");
  });

  it("derives a project api label from uvicorn metadata", () => {
    const out = resolveProcessDisplay({
      pid: 1589962,
      rawName: "uvicorn",
      cwd: "/var/www/AoE2HDBets/api",
      cmdline: "uvicorn app.main:app --host 127.0.0.1 --port 3330",
      ports: [3330],
    });

    expect(out.friendlyName).toBe("aoe2hdbets-api :3330");
  });

  it("humanizes well-known host daemons", () => {
    const out = resolveProcessDisplay({
      pid: 271721,
      rawName: "qemu-ga",
    });

    expect(out.friendlyName).toBe("QEMU guest agent");
    expect(out.secondaryText).toBe("pid 271721 · qemu-ga");
  });

  it("prefers project service wording over vague app unit names", () => {
    const out = resolveProcessDisplay({
      pid: 3439509,
      rawName: "next-server",
      unit: "wheatandstone-app.service",
      cwd: "/var/www/WheatAndStone/ws-app",
      ports: [3010],
    });

    expect(out.friendlyName).toBe("wheatandstone-web :3010");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { applyAlertPolicy } from "../app/dashboard/_lib/alert-policy";

const savedEnv = {
  VPS_ALERT_SUPPRESS_REGEX: process.env.VPS_ALERT_SUPPRESS_REGEX,
  VPS_MAINTENANCE_MODE: process.env.VPS_MAINTENANCE_MODE,
  VPS_MAINTENANCE_UNTIL: process.env.VPS_MAINTENANCE_UNTIL,
  VPS_SUPPRESS_PACKAGES_CHANGED: process.env.VPS_SUPPRESS_PACKAGES_CHANGED,
};

afterEach(() => {
  process.env.VPS_ALERT_SUPPRESS_REGEX = savedEnv.VPS_ALERT_SUPPRESS_REGEX;
  process.env.VPS_MAINTENANCE_MODE = savedEnv.VPS_MAINTENANCE_MODE;
  process.env.VPS_MAINTENANCE_UNTIL = savedEnv.VPS_MAINTENANCE_UNTIL;
  process.env.VPS_SUPPRESS_PACKAGES_CHANGED = savedEnv.VPS_SUPPRESS_PACKAGES_CHANGED;
});

describe("applyAlertPolicy", () => {
  it("keeps critical hardening alerts actionable", () => {
    const out = applyAlertPolicy([
      {
        title: "Watched files changed",
        detail: "Changed:\n/etc/sudoers.d\n/home/tony/.ssh/authorized_keys",
      },
    ]);

    expect(out.actionable).toHaveLength(1);
    expect(out.actionable[0].severityLevel).toBe("critical");
    expect(out.topSeverity).toBe("critical");
  });

  it("suppresses alerts matched by custom regex", () => {
    process.env.VPS_ALERT_SUPPRESS_REGEX = "^Packages changed$";

    const out = applyAlertPolicy([
      { title: "Packages changed", detail: "Upgraded package list..." },
      { title: "Firewall changed", detail: "nft hash changed" },
    ]);

    expect(out.actionable.map((a) => a.title)).toEqual(["Firewall changed"]);
    expect(out.suppressed.map((a) => a.title)).toEqual(["Packages changed"]);
  });

  it("suppresses non-critical alerts during maintenance window", () => {
    process.env.VPS_MAINTENANCE_MODE = "1";
    process.env.VPS_MAINTENANCE_UNTIL = "2099-01-01T00:00:00.000Z";

    const out = applyAlertPolicy([
      { title: "Packages changed", detail: "updated..." },
      { title: "Watched files changed", detail: "Changed:\n/etc/sudoers.d" },
    ]);

    expect(out.maintenanceActive).toBe(true);
    expect(out.actionable.map((a) => a.title)).toEqual(["Watched files changed"]);
    expect(out.suppressed.map((a) => a.title)).toEqual(["Packages changed"]);
  });
});

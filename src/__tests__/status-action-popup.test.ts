import { describe, expect, it } from "vitest";
import {
  isBaselineDriftAlert,
  normalizeAlertCode,
  pickCounterstrikePlaybookId,
} from "@/app/dashboard/_components/status-popup/StatusActionPopup";

describe("StatusActionPopup baseline drift helpers", () => {
  it("treats public_ports_changed as baseline drift", () => {
    const alert = {
      title: "Public listening ports changed",
      detail: "Removed public listeners:\n- tcp|0.0.0.0|37027|node",
      code: "public_ports_changed",
    };

    expect(normalizeAlertCode(alert)).toBe("ports_changed");
    expect(isBaselineDriftAlert(alert)).toBe(true);
  });

  it("classifies cron drift alerts as baseline drift", () => {
    const alert = {
      title: "Cron changed",
      detail: "Changed:\nuser_crontabs_dir_hash",
      code: "cron_changed",
    };

    expect(normalizeAlertCode(alert)).toBe("cron_changed");
    expect(isBaselineDriftAlert(alert)).toBe(true);
  });

  it("infers cron drift alerts from title when the code is missing", () => {
    const alert = {
      title: "Cron changed",
      detail: "Changed:\nuser_crontabs_dir_hash",
      code: null,
    };

    expect(normalizeAlertCode(alert)).toBe("cron_changed");
    expect(isBaselineDriftAlert(alert)).toBe(true);
  });

  it("picks Zap #2 when protected-path runtime signals are present", () => {
    const playbookId = pickCounterstrikePlaybookId({
      snapshot: {
        alerts: [],
        unexpectedPublicPortsCount: 0,
        sshFailedPassword: 0,
        sshInvalidUser: 0,
        threatIndicatorCount: 1,
        suspiciousProcesses: [
          {
            pid: 2211,
            proc: "sh",
            exe: "/bin/sh",
            reasons: ["container has docker socket bind mount"],
          },
        ],
      },
    });

    expect(playbookId).toBe("zap-02-busybox-loader-cutoff");
  });

  it("keeps Zap #1 for ordinary writable-path runtime candidates", () => {
    const playbookId = pickCounterstrikePlaybookId({
      snapshot: {
        alerts: [],
        unexpectedPublicPortsCount: 0,
        sshFailedPassword: 0,
        sshInvalidUser: 0,
        threatIndicatorCount: 1,
        suspiciousProcesses: [
          {
            pid: 2211,
            proc: "kdevtmpfsi",
            exe: "/tmp/kdevtmpfsi",
            reasons: ["user-writable path"],
          },
        ],
      },
    });

    expect(playbookId).toBe("zap-01-miner-persistence-purge");
  });
});

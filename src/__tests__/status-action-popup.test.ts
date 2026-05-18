import { describe, expect, it } from "vitest";
import {
  isBaselineDriftAlert,
  isDiskPressureAlert,
  normalizeAlertCode,
  pickCounterstrikePlaybookId,
} from "@/app/dashboard/_components/status-popup/StatusActionPopup";

type CounterstrikeSnapshot = NonNullable<Parameters<typeof pickCounterstrikePlaybookId>[0]["snapshot"]>;

function makeSnapshot(): CounterstrikeSnapshot {
  return {
    alerts: [],
    unexpectedPublicPortsCount: 0,
    publicPortsTotalCount: 0,
    expectedPublicPorts: [],
    sshFailedPassword: 0,
    sshInvalidUser: 0,
    threatIndicatorCount: 1,
    suspiciousProcesses: [],
    diskPressure: {
      alertCount: 0,
      detail: null,
      safeReclaimableBytes: 0,
      reclaimableBytesTotal: 0,
      rebuildableBytes: 0,
      guidedReclaimableBytes: 0,
      blockedReclaimableBytes: 0,
      runningCleanup: false,
      lastCleanupFinishedAt: null,
      usedPercent: null,
      failPercent: null,
      availableBytes: null,
      totalBytes: null,
    },
  };
}

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

  it("classifies host disk pressure alerts separately", () => {
    const alert = {
      title: "Host disk pressure",
      detail: "/ is 96.2% used with 1.4GB free.",
      code: "host_disk_critical",
    };

    expect(isDiskPressureAlert(alert)).toBe(true);
    expect(isBaselineDriftAlert(alert)).toBe(false);
  });

  it("picks Zap #2 when protected-path runtime signals are present", () => {
    const snapshot = makeSnapshot();
    snapshot.suspiciousProcesses = [
      {
        pid: 2211,
        proc: "sh",
        exe: "/bin/sh",
        reasons: ["container has docker socket bind mount"],
      },
    ];

    const playbookId = pickCounterstrikePlaybookId({
      snapshot,
    });

    expect(playbookId).toBe("zap-02-busybox-loader-cutoff");
  });

  it("keeps Zap #1 for ordinary writable-path runtime candidates", () => {
    const snapshot = makeSnapshot();
    snapshot.suspiciousProcesses = [
      {
        pid: 2211,
        proc: "kdevtmpfsi",
        exe: "/tmp/kdevtmpfsi",
        reasons: ["user-writable path"],
      },
    ];

    const playbookId = pickCounterstrikePlaybookId({
      snapshot,
    });

    expect(playbookId).toBe("zap-01-miner-persistence-purge");
  });
});

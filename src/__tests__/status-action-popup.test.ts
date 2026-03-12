import { describe, expect, it } from "vitest";
import { isBaselineDriftAlert, normalizeAlertCode } from "@/app/dashboard/_components/status-popup/StatusActionPopup";

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
});

import { describe, expect, it } from "vitest";
import {
  panelEmpty,
  panelError,
  panelForbidden,
  panelLoading,
  panelReady,
} from "@/app/dashboard/_lib/panel-health";

describe("dashboard panel health helpers", () => {
  it("builds ready state", () => {
    const state = panelReady("connected", "2026-02-09T00:00:00.000Z");
    expect(state).toEqual({
      status: "ready",
      message: "connected",
      updatedAtIso: "2026-02-09T00:00:00.000Z",
    });
  });

  it("normalizes empty message", () => {
    const state = panelEmpty("   ");
    expect(state.status).toBe("empty");
    expect(state.message).toBe("State unknown");
  });

  it("builds error, forbidden, and loading states", () => {
    expect(panelError("failed").status).toBe("error");
    expect(panelForbidden("role required").status).toBe("forbidden");
    expect(panelLoading("loading").status).toBe("loading");
  });
});

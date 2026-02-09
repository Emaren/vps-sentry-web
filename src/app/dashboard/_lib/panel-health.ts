import type { DashboardPanelHealth } from "./types";

function normalizeMessage(message: string): string {
  const text = message.trim();
  return text.length > 0 ? text : "State unknown";
}

export function panelReady(message: string, updatedAtIso = new Date().toISOString()): DashboardPanelHealth {
  return { status: "ready", message: normalizeMessage(message), updatedAtIso };
}

export function panelEmpty(message: string, updatedAtIso = new Date().toISOString()): DashboardPanelHealth {
  return { status: "empty", message: normalizeMessage(message), updatedAtIso };
}

export function panelError(message: string, updatedAtIso = new Date().toISOString()): DashboardPanelHealth {
  return { status: "error", message: normalizeMessage(message), updatedAtIso };
}

export function panelForbidden(
  message: string,
  updatedAtIso = new Date().toISOString()
): DashboardPanelHealth {
  return { status: "forbidden", message: normalizeMessage(message), updatedAtIso };
}

export function panelLoading(message: string, updatedAtIso = new Date().toISOString()): DashboardPanelHealth {
  return { status: "loading", message: normalizeMessage(message), updatedAtIso };
}

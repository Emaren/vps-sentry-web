// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/styles.ts
import type { CSSProperties } from "react";
import type { FixStepStatus } from "./types";

export function css() {
  return `
  .vps-status-shell {
    position: relative;
    display: grid;
    gap: 12px;
  }

  .vps-status-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .vps-status-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .vps-status-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .vps-status-meta-card {
    display: grid;
    gap: 6px;
    border: 1px solid color-mix(in srgb, var(--dash-card-border) 78%, transparent 22%);
    border-radius: 16px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--dash-link) 7%, transparent 93%), transparent 58%),
      color-mix(in srgb, var(--dash-card-bg) 90%, transparent 10%);
    padding: 12px 14px;
  }

  .vps-primary-cue {
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--dash-card-border) 78%, transparent 22%);
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(255,255,255,0.06), transparent 55%),
      color-mix(in srgb, var(--dash-card-bg) 92%, transparent 8%);
    padding: 12px 14px;
    display: grid;
    gap: 5px;
  }

  .vps-primary-cue[data-tone="bad"] {
    border-color: color-mix(in srgb, var(--dash-sev-critical-border) 82%, transparent 18%);
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(255, 101, 101, 0.12), transparent 52%),
      color-mix(in srgb, var(--dash-sev-critical-bg) 82%, transparent 18%);
  }

  .vps-primary-cue[data-tone="warn"] {
    border-color: color-mix(in srgb, var(--dash-sev-high-border) 82%, transparent 18%);
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(245, 158, 11, 0.12), transparent 52%),
      color-mix(in srgb, var(--dash-sev-high-bg) 84%, transparent 16%);
  }

  .vps-primary-cue-kicker {
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dash-meta);
  }

  .vps-primary-cue-title {
    font-size: 14px;
    font-weight: 900;
    line-height: 1.35;
  }

  .vps-primary-cue-detail {
    font-size: 12px;
    line-height: 1.45;
    color: color-mix(in srgb, var(--dash-fg) 78%, var(--dash-meta) 22%);
  }

  .vps-panel-shell {
    margin-top: 2px;
    position: relative;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--dash-card-border) 82%, transparent 18%);
    border-radius: 18px;
    background:
      radial-gradient(140% 140% at 0% 0%, rgba(255,255,255,0.06), transparent 48%),
      linear-gradient(180deg, color-mix(in srgb, var(--dash-link) 7%, transparent 93%), transparent 62%),
      color-mix(in srgb, var(--dash-card-bg) 92%, transparent 8%);
    padding: 15px;
    display: grid;
    gap: 14px;
  }

  .vps-panel-head {
    display: grid;
    gap: 4px;
  }

  .vps-panel-kicker {
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dash-meta);
  }

  .vps-panel-title {
    font-size: 1rem;
    font-weight: 950;
    line-height: 1.2;
  }

  .vps-actions-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 10px;
  }

  .vps-actions-list-item {
    border: 1px solid color-mix(in srgb, var(--dash-card-border) 74%, transparent 26%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--dash-card-bg) 88%, transparent 12%);
    padding: 11px 12px;
    line-height: 1.45;
  }

  .vps-explain-pre {
    border: 1px solid color-mix(in srgb, var(--dash-card-border) 72%, transparent 28%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--dash-card-bg) 90%, transparent 10%);
    padding: 12px 13px;
  }

  .vps-fix-intro {
    border: 1px solid color-mix(in srgb, var(--dash-card-border) 72%, transparent 28%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--dash-btn-bg) 88%, transparent 12%);
    color: color-mix(in srgb, var(--dash-fg) 78%, var(--dash-meta) 22%);
    padding: 11px 12px;
    font-size: 12px;
    line-height: 1.45;
  }

  .vps-fix-toolbar {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .vps-fix-grid {
    display: grid;
    gap: 12px;
  }

  .vps-step-row {
    position: relative;
    overflow: hidden;
  }

  .vps-step-row::after {
    content: "";
    position: absolute;
    inset: auto 0 0 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
    pointer-events: none;
  }

  .vps-step-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
  }

  .vps-step-icon {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 900;
    background: color-mix(in srgb, var(--dash-btn-bg) 88%, transparent 12%);
    border: 1px solid color-mix(in srgb, var(--dash-card-border) 76%, transparent 24%);
  }

  .vps-step-label {
    font-weight: 850;
    line-height: 1.35;
  }

  .vps-step-state {
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--dash-card-border) 74%, transparent 26%);
    background: color-mix(in srgb, var(--dash-btn-bg) 88%, transparent 12%);
    color: var(--dash-meta);
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .vps-step-detail {
    margin-top: 8px;
    font-size: 12px;
    line-height: 1.5;
    color: color-mix(in srgb, var(--dash-fg) 76%, var(--dash-meta) 24%);
  }

  .vps-result-card {
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--dash-card-border) 78%, transparent 22%);
    background: color-mix(in srgb, var(--dash-card-bg) 90%, transparent 10%);
    padding: 13px 14px;
    display: grid;
    gap: 8px;
  }

  .vps-result-card[data-ok="true"] {
    border-color: color-mix(in srgb, var(--dash-sev-ok-border) 80%, transparent 20%);
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(34, 197, 94, 0.10), transparent 52%),
      color-mix(in srgb, var(--dash-sev-ok-bg) 84%, transparent 16%);
  }

  .vps-result-card[data-ok="false"] {
    border-color: color-mix(in srgb, var(--dash-sev-critical-border) 80%, transparent 20%);
    background:
      radial-gradient(120% 140% at 0% 0%, rgba(255, 90, 90, 0.10), transparent 52%),
      color-mix(in srgb, var(--dash-sev-critical-bg) 84%, transparent 16%);
  }

  .vps-result-title {
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dash-meta);
  }

  .vps-result-message {
    font-size: 14px;
    font-weight: 850;
    line-height: 1.4;
  }

  .vps-result-details {
    display: grid;
    gap: 7px;
  }

  .vps-result-detail {
    font-size: 12px;
    line-height: 1.45;
    color: color-mix(in srgb, var(--dash-fg) 78%, var(--dash-meta) 22%);
  }

  .vps-panel-footer {
    display: flex;
    justify-content: flex-end;
  }

  .vps-light {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    display: inline-block;
    flex: 0 0 auto;
  }

  /* GREEN: gentle pulse */
  .vps-light-ok {
    background: rgba(70, 255, 140, 0.9);
    box-shadow: 0 0 10px rgba(70, 255, 140, 0.35), 0 0 24px rgba(70, 255, 140, 0.18);
    animation: vpsPulse 1.8s ease-in-out infinite;
  }

  /* YELLOW: medium pulse */
  .vps-light-warn {
    background: rgba(255, 210, 70, 0.95);
    box-shadow: 0 0 10px rgba(255, 210, 70, 0.32), 0 0 24px rgba(255, 210, 70, 0.16);
    animation: vpsPulse 1.2s ease-in-out infinite;
  }

  /* RED: slower "alarm" flash */
  .vps-light-bad {
    background: rgba(255, 70, 70, 0.95);
    box-shadow: 0 0 10px rgba(255, 70, 70, 0.34), 0 0 24px rgba(255, 70, 70, 0.18);
    animation: vpsFlash 1.4s ease-in-out infinite;
  }

  @keyframes vpsPulse {
    0% { transform: scale(1); opacity: 0.85; }
    50% { transform: scale(1.08); opacity: 1; }
    100% { transform: scale(1); opacity: 0.85; }
  }

  @keyframes vpsFlash {
    0% { opacity: 0.35; transform: scale(1); }
    40% { opacity: 1; transform: scale(1.05); }
    100% { opacity: 0.35; transform: scale(1); }
  }

  .vps-cursor {
    display: inline-block;
    width: 8px;
    height: 14px;
    margin-left: 2px;
    background: var(--dash-cursor, rgba(255,255,255,0.65));
    vertical-align: -2px;
    animation: vpsBlink 0.9s step-end infinite;
  }

  @keyframes vpsBlink {
    50% { opacity: 0; }
  }
  `;
}

export function stepRow(status: FixStepStatus): CSSProperties {
  const base: CSSProperties = {
    borderRadius: 14,
    border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
    background: "var(--dash-card-bg, rgba(255,255,255,0.04))",
    padding: "13px 14px",
  };

  if (status === "running") {
    return {
      ...base,
      border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.22))",
      background: "var(--dash-btn-bg-strong, rgba(255,255,255,0.06))",
      boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 0 18px rgba(255,255,255,0.06)",
    };
  }

  if (status === "success") {
    return {
      ...base,
      border: "1px solid rgba(80, 255, 160, 0.25)",
      boxShadow: "0 0 0 1px rgba(80, 255, 160, 0.06), 0 0 18px rgba(80, 255, 160, 0.06)",
    };
  }

  if (status === "error") {
    return {
      ...base,
      border: "1px solid rgba(255, 90, 90, 0.25)",
      boxShadow: "0 0 0 1px rgba(255, 90, 90, 0.06), 0 0 18px rgba(255, 90, 90, 0.06)",
    };
  }

  return base;
}

export function btn(): CSSProperties {
  return {
    borderRadius: "999px",
    border: "1px solid color-mix(in srgb, var(--dash-btn-border, rgba(255,255,255,0.18)) 82%, transparent 18%)",
    background:
      "linear-gradient(180deg, color-mix(in srgb, var(--dash-btn-bg-strong, rgba(255,255,255,0.08)) 68%, transparent 32%), var(--dash-btn-bg, rgba(255,255,255,0.05)))",
    padding: "10px 14px",
    fontWeight: 900,
    letterSpacing: "0.01em",
    cursor: "pointer",
    color: "inherit",
  };
}

export function btnStrong(): CSSProperties {
  return {
    ...btn(),
    border: "1px solid color-mix(in srgb, var(--dash-sev-high-border, rgba(245,158,11,0.3)) 72%, transparent 28%)",
    background:
      "linear-gradient(180deg, color-mix(in srgb, var(--dash-sev-high-bg, rgba(245,158,11,0.14)) 78%, transparent 22%), color-mix(in srgb, var(--dash-btn-bg-strong, rgba(255,255,255,0.08)) 88%, transparent 12%))",
  };
}

export function okBtn(): CSSProperties {
  return {
    ...btn(),
    padding: "9px 14px",
    fontWeight: 900,
    cursor: "pointer",
  };
}

export function caretBtn(): CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
    background: "var(--dash-card-bg, rgba(255,255,255,0.03))",
    padding: "6px 10px",
    fontWeight: 900,
    cursor: "pointer",
    color: "inherit",
    lineHeight: "14px",
  };
}

export function xBtn(): CSSProperties {
  return {
    position: "absolute",
    top: -2,
    right: -2,
    borderRadius: 12,
    border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
    background: "var(--dash-card-bg, rgba(255,255,255,0.04))",
    width: 32,
    height: 32,
    cursor: "pointer",
    color: "inherit",
    fontSize: 20,
    fontWeight: 900,
    lineHeight: "30px",
    textAlign: "center",
  };
}

export function typedPre(): CSSProperties {
  return {
    margin: 0,
    whiteSpace: "pre-wrap",
    opacity: 0.92,
    fontSize: 13,
    lineHeight: 1.5,
  };
}

// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/styles.ts
import type { CSSProperties } from "react";
import type { FixStepStatus } from "./types";

export function css() {
  return `
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
    background: rgba(255,255,255,0.65);
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
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: "10px 12px",
  };

  if (status === "running") {
    return {
      ...base,
      border: "1px solid rgba(255,255,255,0.22)",
      background: "rgba(255,255,255,0.06)",
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
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    padding: "10px 12px",
    fontWeight: 900,
    cursor: "pointer",
    color: "inherit",
  };
}

export function btnStrong(): CSSProperties {
  return {
    ...btn(),
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(255,255,255,0.08)",
  };
}

export function okBtn(): CSSProperties {
  return {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    padding: "10px 18px",
    fontWeight: 950,
    cursor: "pointer",
    color: "inherit",
    minWidth: 110,
    textAlign: "center",
  };
}

export function caretBtn(): CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
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
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
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

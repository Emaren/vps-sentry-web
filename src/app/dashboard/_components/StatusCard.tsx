"use client";

// src/app/dashboard/_components/StatusCard.tsx
import React from "react";
import ActionNeededDrawer from "./ActionNeededDrawer";
import type { ActionSummary } from "../_lib/explain";
import { boxStyle, subtleText, tinyText } from "../_styles";

export default function StatusCard(props: {
  headline: string;
  needsAction: boolean;
  host: string;
  version: string;
  scanTsLabel: string;
  baselineTsLabel: string;
  signedInAs: string;
  summary: ActionSummary;
}) {
  const { headline, needsAction, host, version, scanTsLabel, baselineTsLabel, signedInAs, summary } =
    props;

  const [open, setOpen] = React.useState(false);

  return (
    <>
      <div
        style={{
          ...boxStyle,
          cursor: needsAction ? "pointer" : "default",
          userSelect: "none",
        }}
        onClick={() => {
          if (needsAction) setOpen(true);
        }}
        role={needsAction ? "button" : undefined}
        aria-label={needsAction ? "Open what’s wrong panel" : undefined}
      >
        <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 10 }}>
          Status:{" "}
          <span style={{ fontWeight: 1000 }}>
            {headline}
          </span>
          {needsAction ? (
            <span style={{ ...tinyText }}>(tap)</span>
          ) : null}
        </div>

        <div style={{ marginTop: 8, ...subtleText }}>
          Host: <b>{host}</b> · Version: <b>{version}</b>
        </div>

        <div style={{ marginTop: 6, ...subtleText }}>
          Snapshot: <b>{scanTsLabel}</b>
        </div>

        <div style={{ marginTop: 6, ...subtleText }}>
          Baseline accepted: <b>{baselineTsLabel}</b>
        </div>

        <div style={{ marginTop: 8, ...tinyText }}>
          Signed in as <b>{signedInAs}</b>
        </div>

        {needsAction ? (
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              style={btn()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(true);
              }}
            >
              AI Explain
            </button>
            <button
              style={btn()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(true);
              }}
            >
              Fix Now
            </button>
          </div>
        ) : null}
      </div>

      <ActionNeededDrawer
        open={open}
        onClose={() => setOpen(false)}
        summary={summary}
        asOfLabel={scanTsLabel}
      />
    </>
  );
}

function btn(): React.CSSProperties {
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

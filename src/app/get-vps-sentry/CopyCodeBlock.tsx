"use client";

import { useState } from "react";

export default function CopyCodeBlock(props: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <pre
          style={{
            margin: 0,
            padding: "12px 0 12px 14px",
            whiteSpace: "pre-wrap",
            overflowX: "auto",
            lineHeight: 1.45,
            fontSize: 13,
            flex: 1,
            minWidth: 0,
          }}
        >
          <code>{props.text}</code>
        </pre>
        <div style={{ padding: "10px 10px 0 0", flexShrink: 0 }}>
          <button
            type="button"
            onClick={onCopy}
            style={{
              padding: "6px 9px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              color: "inherit",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
            aria-live="polite"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

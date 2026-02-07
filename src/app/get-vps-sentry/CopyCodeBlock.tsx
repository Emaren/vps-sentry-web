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
        position: "relative",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <button
        type="button"
        onClick={onCopy}
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          zIndex: 1,
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

      <pre
        style={{
          margin: 0,
          padding: "12px 110px 12px 14px",
          whiteSpace: "pre-wrap",
          overflowX: "auto",
          lineHeight: 1.45,
          fontSize: 13,
        }}
      >
        <code>{props.text}</code>
      </pre>
    </div>
  );
}

// src/app/dashboard/_components/DebugPanel.tsx
import React from "react";
import { boxStyle, subtleText } from "../_styles";

export default function DebugPanel(props: { raw: string }) {
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 900, opacity: 0.9 }}>
        Debug (advanced)
      </summary>
      <div style={{ ...boxStyle, marginTop: 10 }}>
        <div style={{ fontWeight: 900 }}>Raw /api/status payload</div>
        <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", opacity: 0.9 }}>
          {props.raw}
        </pre>
        <div style={{ marginTop: 8, ...subtleText }}>
          Tip: if this gets huge, we’ll move it to <code>/debug</code>.
        </div>
      </div>
    </details>
  );
}

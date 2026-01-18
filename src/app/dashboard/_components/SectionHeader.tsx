// src/app/dashboard/_components/SectionHeader.tsx
import React from "react";
import { tinyText } from "../_styles";

export default function SectionHeader(props: { title: string; asOf?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>{props.title}</h2>
      {props.asOf ? <div style={tinyText}>as of <b>{props.asOf}</b></div> : null}
    </div>
  );
}

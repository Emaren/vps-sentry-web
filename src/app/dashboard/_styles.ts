// src/app/dashboard/_styles.ts
import type React from "react";

export const boxStyle: React.CSSProperties = {
  border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
  borderRadius: 14,
  padding: 14,
  background: "var(--dash-card-bg, rgba(255,255,255,0.03))",
  boxShadow: "var(--dash-card-shadow, none)",
};

export const thStyle: React.CSSProperties = { padding: "8px 6px" };
export const tdStyle: React.CSSProperties = { padding: "10px 6px", verticalAlign: "top" };

export const subtleText: React.CSSProperties = { opacity: 0.75 };
export const tinyText: React.CSSProperties = { opacity: 0.7, fontSize: 12 };

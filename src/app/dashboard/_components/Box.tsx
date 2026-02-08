// /var/www/vps-sentry-web/src/app/dashboard/_components/Box.tsx
import React from "react";

export const boxStyle: React.CSSProperties = {
  border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
  borderRadius: 14,
  padding: 14,
  background: "var(--dash-card-bg, rgba(255,255,255,0.03))",
  boxShadow: "var(--dash-card-shadow, none)",
};

export default function Box({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <div style={{ ...boxStyle, ...(style ?? {}) }}>{children}</div>;
}

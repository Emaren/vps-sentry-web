// /var/www/vps-sentry-web/src/app/dashboard/_components/Box.tsx
import React from "react";

export const boxStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
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

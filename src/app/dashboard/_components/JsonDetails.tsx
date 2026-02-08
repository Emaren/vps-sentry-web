// /var/www/vps-sentry-web/src/app/dashboard/_components/JsonDetails.tsx
import React from "react";

export default function JsonDetails({
  title,
  subtitle,
  jsonText,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  jsonText: string;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 800 }}>
        {title}
        {subtitle ? <span style={{ fontWeight: 500, opacity: 0.75 }}> — {subtitle}</span> : null}
      </summary>
      <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", opacity: 0.9 }}>
        {jsonText}
      </pre>
    </details>
  );
}

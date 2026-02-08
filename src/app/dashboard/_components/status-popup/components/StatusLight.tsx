// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/components/StatusLight.tsx
import React from "react";
import type { Level } from "../types";

export default function StatusLight({ level }: { level: Level }) {
  const cls =
    level === "ok"
      ? "vps-light vps-light-ok"
      : level === "warn"
        ? "vps-light vps-light-warn"
        : "vps-light vps-light-bad";
  return <span className={cls} />;
}

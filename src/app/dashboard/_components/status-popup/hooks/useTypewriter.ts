"use client";

import * as React from "react";

export type TypewriterOptions = {
  /**
   * Characters per second.
   * Default: 90 cps (roughly 1.5 chars per 16ms tick).
   */
  cps?: number;

  /**
   * If true, when enabled becomes false we keep the already-typed text
   * (instead of clearing it).
   * Default: false (matches your current behavior: clears when disabled).
   */
  preserveOnDisable?: boolean;
};

export function useTypewriter(
  text: string,
  enabled: boolean,
  opts?: TypewriterOptions
) {
  const cps = Math.max(1, opts?.cps ?? 90);
  const tickMs = Math.max(10, Math.floor(1000 / cps));
  const preserveOnDisable = opts?.preserveOnDisable ?? false;

  const [out, setOut] = React.useState("");

  React.useEffect(() => {
    const full = text ?? "";

    // Disabled behavior
    if (!enabled) {
      if (!preserveOnDisable) setOut("");
      return;
    }

    // Enabled behavior: type out progressively
    let i = 0;
    let timer: number | null = null;
    let cancelled = false;

    // Start fresh each time enabled/text changes (matches your current behavior)
    setOut("");

    const stepChars = Math.max(1, Math.round(cps * (tickMs / 1000)));

    const tick = () => {
      if (cancelled) return;

      i = Math.min(full.length, i + stepChars);
      setOut(full.slice(0, i));

      if (i < full.length) {
        timer = window.setTimeout(tick, tickMs);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [text, enabled, cps, tickMs, preserveOnDisable]);

  return out;
}

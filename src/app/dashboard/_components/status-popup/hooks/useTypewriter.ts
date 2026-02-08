"use client";

import React from "react";

export function useTypewriter(text: string, enabled: boolean) {
  const [out, setOut] = React.useState("");

  React.useEffect(() => {
    if (!enabled) {
      setOut("");
      return;
    }

    let i = 0;
    let raf: number | null = null;

    const tick = () => {
      i = Math.min(text.length, i + 3);
      setOut(text.slice(0, i));
      if (i < text.length) raf = window.setTimeout(tick, 16);
    };

    tick();

    return () => {
      if (raf) window.clearTimeout(raf);
    };
  }, [text, enabled]);

  return out;
}

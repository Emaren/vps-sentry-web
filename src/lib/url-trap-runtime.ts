function short(v: unknown) {
  try {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") return JSON.stringify(v).slice(0, 500);
    return String(v);
  } catch {
    return String(v);
  }
}

function toRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object") return null;
  return v as Record<string, unknown>;
}

function toInputString(v: unknown): string {
  if (typeof v === "string") return v;
  const rec = toRecord(v);
  if (rec && typeof rec.href === "string") return rec.href;
  if (rec && typeof rec.url === "string") return rec.url;
  return String(v);
}

export {};

declare global {
  var __URL_TRAP_INSTALLED__: boolean | undefined;
}

if (
  process.env.URL_TRAP === "1" ||
  process.env.NEXT_PHASE === "phase-production-build"
) {
  const RealURL = globalThis.URL;

  // Only patch once
  if (!globalThis.__URL_TRAP_INSTALLED__) {
    globalThis.__URL_TRAP_INSTALLED__ = true;

    globalThis.URL = new Proxy(RealURL, {
      construct(target, args) {
        const [input, base] = args || [];
        const s = toInputString(input);

        if (s.includes("[object Object]")) {
          console.error("\n=== URL TRAP (runtime) ===");
          console.error("input:", short(input));
          console.error("base :", short(base));
          const rec = toRecord(input);
          if (rec) {
            console.error("keys :", Object.keys(rec));
          }
          console.error(new Error("URL TRAP stack").stack);
          console.error("=== /URL TRAP ===\n");
        }

        return Reflect.construct(target, args);
      },
    });
  }
}

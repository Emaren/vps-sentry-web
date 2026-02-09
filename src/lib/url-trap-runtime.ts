/* eslint-disable no-console */

function short(v: unknown) {
  try {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") return JSON.stringify(v).slice(0, 500);
    return String(v);
  } catch {
    return String(v);
  }
}

if (
  process.env.URL_TRAP === "1" ||
  process.env.NEXT_PHASE === "phase-production-build"
) {
  const RealURL = globalThis.URL;

  // Only patch once
  if (!(globalThis as any).__URL_TRAP_INSTALLED__) {
    (globalThis as any).__URL_TRAP_INSTALLED__ = true;

    globalThis.URL = new Proxy(RealURL, {
      construct(target, args) {
        const [input, base] = args || [];

        const s =
          typeof input === "string"
            ? input
            : input && typeof input === "object" && typeof (input as any).href === "string"
              ? (input as any).href
              : input && typeof input === "object" && typeof (input as any).url === "string"
                ? (input as any).url
                : String(input);

        if (s.includes("[object Object]")) {
          console.error("\n=== URL TRAP (runtime) ===");
          console.error("input:", short(input));
          console.error("base :", short(base));
          if (input && typeof input === "object") {
            console.error("keys :", Object.keys(input as any));
          }
          console.error(new Error("URL TRAP stack").stack);
          console.error("=== /URL TRAP ===\n");
        }

        return new (target as any)(...args);
      },
    }) as any;
  }
}

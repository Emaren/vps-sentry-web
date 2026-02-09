const urlMod = require("node:url");
const legacyUrlMod = require("url");

const RealURL = urlMod.URL;

function wrap(Real) {
  return new Proxy(Real, {
    construct(target, args) {
      const [input, base] = args || [];
      const t = typeof input;

      let s;
      if (t === "string") s = input;
      else if (input && t === "object" && typeof input.href === "string") s = input.href;
      else if (input && t === "object" && typeof input.url === "string") s = input.url;
      else s = String(input);

      const looksBad = s.includes("[object Object]");

      if (looksBad) {
        console.error("\n=== URL TRAP ===");
        console.error("inputType:", t);
        console.error("input:", input);
        console.error("string:", s);
        console.error("base :", base);
        if (input && t === "object") console.error("keys :", Object.keys(input));
        console.error(new Error("URL TRAP stack").stack);
        console.error("=== /URL TRAP ===\n");
      }

      return new target(...args);
    },
  });
}

const WrappedURL = wrap(RealURL);

global.URL = WrappedURL;
urlMod.URL = WrappedURL;
legacyUrlMod.URL = WrappedURL;

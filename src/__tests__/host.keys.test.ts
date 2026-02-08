import { describe, expect, it } from "vitest";
import {
  HOST_KEY_DEFAULT_SCOPES,
  generateHostKeyTokenBundle,
  hostKeyHasScope,
  hostKeyScopeSummary,
  nextHostKeyVersion,
  normalizeHostKeyScopes,
  parseHostKeyScopes,
  serializeHostKeyScopes,
  sha256Token,
} from "../lib/host-keys";

describe("host key lifecycle helpers", () => {
  it("normalizes and orders scopes from mixed input", () => {
    const out = normalizeHostKeyScopes([
      "host.history.read",
      "HOST.STATUS.READ",
      "host.status.read",
      "invalid.scope",
      "host.status.write",
    ]);

    expect(out).toEqual([
      "host.status.write",
      "host.status.read",
      "host.history.read",
    ]);
  });

  it("falls back to defaults when parsing invalid scope JSON", () => {
    expect(parseHostKeyScopes("{not json")).toEqual(HOST_KEY_DEFAULT_SCOPES);
    expect(parseHostKeyScopes(null)).toEqual(HOST_KEY_DEFAULT_SCOPES);
  });

  it("serializes and parses scopes with stable summary", () => {
    const serialized = serializeHostKeyScopes(["host.history.read", "host.status.write"]);
    const parsed = parseHostKeyScopes(serialized);

    expect(parsed).toEqual(["host.status.write", "host.history.read"]);
    expect(hostKeyHasScope(parsed, "host.status.write")).toBe(true);
    expect(hostKeyHasScope(parsed, "host.status.read")).toBe(false);
    expect(hostKeyScopeSummary(parsed)).toBe("host.status.write, host.history.read");
  });

  it("generates versioned tokens and matching hashes", () => {
    const bundle = generateHostKeyTokenBundle(7);

    expect(bundle.version).toBe(7);
    expect(bundle.token.startsWith("vs7_")).toBe(true);
    expect(bundle.tokenHash).toBe(sha256Token(bundle.token));
    expect(bundle.tokenHash).toHaveLength(64);
    expect(bundle.prefix.endsWith("...")).toBe(true);
  });

  it("computes next key version and clamps max", () => {
    expect(nextHostKeyVersion([{ version: 1 }, { version: 9 }, { version: null }])).toBe(10);
    expect(nextHostKeyVersion([{ version: 9999 }])).toBe(9999);
  });
});

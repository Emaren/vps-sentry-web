import { describe, expect, it } from "vitest";
import { gunzipSync, unzipSync } from "fflate";
import { spawnSync } from "node:child_process";
import { buildLocalArchive, buildTar, validateArchiveEntries, type ArchiveEntry } from "@/lib/archive/browser-archive";

const encode = (s: string) => new TextEncoder().encode(s);
const make = (path: string, s = "evidence"): ArchiveEntry => ({ path, bytes: encode(s), lastModified: Date.UTC(2026, 10, 9) });

describe("private browser folder archives", () => {
  it("creates an independently decodable ZIP preserving nested paths and bytes", () => {
    const archive = buildLocalArchive([make("IES/case/Pleading.pdf", "PDF-CONTENT"), make("IES/emails/notice.eml", "EMAIL")], "zip");
    const files = unzipSync(archive);
    expect(new TextDecoder().decode(files["IES/case/Pleading.pdf"])).toBe("PDF-CONTENT");
    expect(new TextDecoder().decode(files["IES/emails/notice.eml"])).toBe("EMAIL");
  });
  it("creates a gzip-wrapped valid ustar TAR with file content", () => {
    const tar = gunzipSync(buildLocalArchive([make("IES/notice.txt", "HELLO")], "tgz"));
    expect(new TextDecoder().decode(tar.slice(0, 14))).toContain("IES/notice.txt");
    expect(new TextDecoder().decode(tar.slice(257, 262))).toBe("ustar");
    expect(new TextDecoder().decode(tar.slice(512, 517))).toBe("HELLO");
    expect(tar.slice(-1024).every((byte) => byte === 0)).toBe(true);
  });
  it("writes PAX records for long Unicode names without truncating them", () => {
    const longName = "IES/" + "exhibits-".repeat(14) + "é.pdf";
    const tar = buildTar([make(longName)]);
    const metadata = new TextDecoder().decode(tar.slice(512, 1024));
    expect(metadata).toContain("path=" + longName);
    const listing = spawnSync("tar", ["-tzf", "-"], {
      input: Buffer.from(buildLocalArchive([make(longName)], "tgz")),
      encoding: "utf8",
    });
    expect(listing.status).toBe(0);
    expect(listing.stdout.normalize("NFC")).toContain(longName.normalize("NFC"));
  });
  it("fails closed on traversal, duplicates and broad roots", () => {
    expect(() => validateArchiveEntries([make("IES/../secret.txt")])).toThrow();
    expect(() => validateArchiveEntries([make("IES/a"), make("IES/a")])).toThrow();
    expect(() => validateArchiveEntries([make("Desktop/private.pdf")])).toThrow();
    expect(() => validateArchiveEntries([make("IES/a"), make("Other/a")])).toThrow();
    expect(() => validateArchiveEntries([])).toThrow();
  });
});

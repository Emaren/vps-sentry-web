import { gzipSync, zipSync } from "fflate";
export type LocalArchiveMode = "zip" | "tgz" | "both";
export type ArchiveEntry = { path: string; bytes: Uint8Array; lastModified: number };
const enc = new TextEncoder();
const BLOCK = 512;
export function validateArchiveEntries(entries: ArchiveEntry[]): void {
  if (!entries.length) throw new Error("The selected folder contains no accessible files.");
  const seen = new Set<string>();
  const root = entries[0].path.split("/")[0];
  if (["Desktop", "Downloads", "Documents", "Users", "home"].includes(root)) {
    throw new Error("Choose the specific case folder, not a broad system folder.");
  }
  for (const { path } of entries) {
    if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") ||
        path.split("/").some((s) => !s || s === "." || s === "..") || !path.startsWith(root + "/"))
      throw new Error("Unsafe or out-of-folder archive path: " + path);
    if (seen.has(path)) throw new Error("Duplicate archive entry: " + path);
    seen.add(path);
  }
}
function str(buf: Uint8Array, offset: number, width: number, s: string): void {
  const bytes = enc.encode(s);
  if (bytes.length > width) throw new Error("TAR header field too long.");
  buf.set(bytes, offset);
}
function oct(buf: Uint8Array, offset: number, width: number, n: number): void {
  const digits = Math.floor(n).toString(8);
  if (digits.length >= width) throw new Error("TAR field exceeds format limit.");
  str(buf, offset, width, digits.padStart(width - 1, "0") + "\0");
}
function header(name: string, size: number, modified: number, type: "0" | "x"): Uint8Array {
  const h = new Uint8Array(BLOCK);
  str(h, 0, 100, name);
  oct(h, 100, 8, 0o644);
  oct(h, 108, 8, 0); oct(h, 116, 8, 0);
  oct(h, 124, 12, size);
  oct(h, 136, 12, Math.max(0, Math.floor(modified / 1000)));
  h.fill(32, 148, 156);
  str(h, 156, 1, type);
  str(h, 257, 6, "ustar\0");
  str(h, 263, 2, "00");
  let sum = 0; for (const b of h) sum += b;
  str(h, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}
function pad(bytes: Uint8Array): Uint8Array {
  if (bytes.length % BLOCK === 0) return bytes;
  const out = new Uint8Array(Math.ceil(bytes.length / BLOCK) * BLOCK);
  out.set(bytes);
  return out;
}
function pax(path: string): Uint8Array {
  const item = "path=" + path + "\n";
  let n = enc.encode(item).length + 3;
  while (true) {
    const data = enc.encode(String(n) + " " + item);
    if (data.length === n) return data;
    n = data.length;
  }
}
export function buildTar(entries: ArchiveEntry[]): Uint8Array {
  validateArchiveEntries(entries);
  const chunks: Uint8Array[] = [];
  let total = 1024;
  entries.forEach((item, i) => {
    const requiresPax = enc.encode(item.path).length > 100 || /[^\x20-\x7E]/.test(item.path);
    if (requiresPax) {
      const meta = pax(item.path);
      const m = [header("PaxHeaders/" + i, meta.length, item.lastModified, "x"), pad(meta)];
      chunks.push(...m); total += m[0].length + m[1].length;
    }
    const parts = [header(requiresPax ? "archive-item-" + i : item.path, item.bytes.length, item.lastModified, "0"), pad(item.bytes)];
    chunks.push(...parts); total += parts[0].length + parts[1].length;
  });
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of chunks) { out.set(part, cursor); cursor += part.length; }
  return out;
}
export function buildLocalArchive(entries: ArchiveEntry[], mode: "zip" | "tgz"): Uint8Array {
  validateArchiveEntries(entries);
  if (mode === "tgz") return gzipSync(buildTar(entries), { level: 1 });
  const files: Record<string, [Uint8Array, { level: 1; mtime: Date }]> = {};
  for (const f of entries) files[f.path] = [f.bytes, { level: 1, mtime: new Date(f.lastModified || Date.now()) }];
  return zipSync(files, { level: 1 });
}

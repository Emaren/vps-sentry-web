"use client";

import React from "react";
import { boxStyle, subtleText, tinyText } from "@/app/dashboard/_styles";
import { hasRequiredRole, type AppRole } from "@/lib/rbac-policy";
import { buildLocalArchive, type ArchiveEntry, type LocalArchiveMode } from "@/lib/archive/browser-archive";

type Target = "local" | "server";
type FileChoice = { path: string; file: File };
type Selection = { root: string; files: FileChoice[]; size: number };
type ArchiveDownload = { name: string; url: string; checksumUrl: string; size: number };
type FileHandle = { kind: "file"; name: string; getFile(): Promise<File> };
type DirectoryHandle = { kind: "directory"; name: string; values(): AsyncIterable<FileHandle | DirectoryHandle> };
type FolderPickerWindow = Window & { showDirectoryPicker?: (options?: { mode: "read" }) => Promise<DirectoryHandle> };

const MAX_FILES = 10000;
const MAX_BYTES = 512 * 1024 * 1024;
const serverDefaultOutdir = "/var/www/VPSSentry/context";
const localDefaultOutdir = "~/Downloads";
const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "9px 10px", borderRadius: 10,
  border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
  background: "var(--site-input-bg, rgba(255,255,255,0.03))", color: "inherit",
};
const buttonStyle: React.CSSProperties = {
  padding: "10px 15px", borderRadius: 10, fontWeight: 850, cursor: "pointer",
  border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.2))",
  background: "var(--dash-btn-bg-strong, rgba(255,255,255,0.08))", color: "inherit",
};
function prettyBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}
function errText(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function shellQuote(v: string): string { return "'" + v.replace(/'/g, "'\"'\"'") + "'"; }
function fallbackCommand(src: string, outdir: string, mode: LocalArchiveMode): string {
  const commands = [
    "SRC=" + shellQuote(src.trim() || "<PASTE_EXACT_FOLDER_PATH>"),
    "OUTDIR=" + shellQuote(outdir.trim() || localDefaultOutdir),
    'if [ "$OUTDIR" = "~/Downloads" ]; then OUTDIR="$HOME/Downloads"; fi',
    'if [ ! -d "$SRC" ]; then echo HOLD_SOURCE_NOT_FOUND; elif [ "$(basename "$SRC")" = Desktop ]; then echo HOLD_SELECT_SPECIFIC_FOLDER; else',
    '  mkdir -p "$OUTDIR"',
    '  NAME=$(basename "$SRC" | tr -cd "A-Za-z0-9._-")',
    '  STAMP=$(date -u +%Y%m%d-%H%M%S)',
  ];
  if (mode !== "tgz") commands.push('  ZIP="$OUTDIR/$NAME-$STAMP.zip"; if ditto -c -k --keepParent "$SRC" "$ZIP" && unzip -t "$ZIP" >/dev/null; then (cd "$OUTDIR" && shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256"); echo PASS_ZIP="$ZIP"; else echo HOLD_ZIP; fi');
  if (mode !== "zip") commands.push('  TGZ="$OUTDIR/$NAME-$STAMP.tgz"; if tar -czf "$TGZ" -C "$(dirname "$SRC")" "$(basename "$SRC")" && tar -tzf "$TGZ" >/dev/null; then (cd "$OUTDIR" && shasum -a 256 "$(basename "$TGZ")" > "$(basename "$TGZ").sha256"); echo PASS_TGZ="$TGZ"; else echo HOLD_TGZ; fi');
  commands.push("fi");
  return commands.join("\n");
}
function validateSelection(root: string, choices: FileChoice[]): Selection {
  if (["Desktop", "Documents", "Downloads", "Users", "home"].includes(root)) {
    throw new Error("Select your specific case or project folder (such as IES), not Desktop or another broad folder.");
  }
  if (!choices.length) throw new Error("No accessible files were found. Select a folder containing documents.");
  if (choices.length > MAX_FILES) throw new Error("This selection exceeds the 10,000-file browser safety limit. Use the terminal backup.");
  const seen = new Set<string>();
  let size = 0;
  for (const item of choices) {
    const parts = item.path.split("/");
    if (parts[0] !== root || parts.length < 2 || parts.some((p) => !p || p === ".." || p === ".") || item.path.includes("\\") || item.path.includes("\0")) {
      throw new Error("Invalid or out-of-folder file path.");
    }
    if (seen.has(item.path)) throw new Error("Duplicate file path: " + item.path);
    seen.add(item.path);
    size += item.file.size;
    if (size > MAX_BYTES) throw new Error("Selection is over 512 MB. Use the terminal backup to avoid exhausting browser memory.");
  }
  return { root, files: choices.sort((a, b) => a.path.localeCompare(b.path)), size };
}
async function fromDirectory(handle: DirectoryHandle): Promise<Selection> {
  const files: FileChoice[] = [];
  async function descend(dir: DirectoryHandle, prefix: string): Promise<void> {
    for await (const item of dir.values()) {
      if (item.kind === "directory") {
        await descend(item, prefix + item.name + "/");
      } else {
        const file = await item.getFile();
        files.push({ path: prefix + item.name, file });
        if (files.length > MAX_FILES) throw new Error("More than 10,000 files. Select a smaller folder.");
      }
    }
  }
  await descend(handle, handle.name + "/");
  return validateSelection(handle.name, files);
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
function makeUrl(bytes: Uint8Array, contentType: string): string {
  const copied = new Uint8Array(bytes.length);
  copied.set(bytes);
  return URL.createObjectURL(new Blob([copied.buffer], { type: contentType }));
}

export default function ArchiveFolderCard({ userRole }: { userRole: AppRole }) {
  const canRunServer = hasRequiredRole(userRole, "ops");
  const [target, setTarget] = React.useState<Target>("local");
  const [mode, setMode] = React.useState<LocalArchiveMode>("zip");
  const [selected, setSelected] = React.useState<Selection | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [error, setError] = React.useState("");
  const [downloads, setDownloads] = React.useState<ArchiveDownload[]>([]);
  const [src, setSrc] = React.useState("");
  const [outdir, setOutdir] = React.useState(localDefaultOutdir);
  const [serverResult, setServerResult] = React.useState("");
  const fallbackInput = React.useRef<HTMLInputElement>(null);
  const urls = React.useRef<string[]>([]);
  const clearDownloads = React.useCallback(() => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    setDownloads([]);
  }, []);
  React.useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  const switchTarget = (next: Target) => {
    clearDownloads(); setError(""); setStatus(""); setTarget(next);
    setOutdir(next === "local" ? localDefaultOutdir : serverDefaultOutdir);
  };
  const chooseFolder = async () => {
    setError(""); setStatus(""); clearDownloads();
    const picker = (window as FolderPickerWindow).showDirectoryPicker;
    if (!picker) { fallbackInput.current?.click(); return; }
    try {
      const handle = await picker({ mode: "read" });
      setSelected(await fromDirectory(handle));
      setStatus("Folder selected. Review the file count, then create your archive.");
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError("Folder selection failed: " + errText(e));
    }
  };
  const chooseFallback = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    try {
      const paths = files.map((f) => f.webkitRelativePath);
      if (paths.some((p) => !p || !p.includes("/"))) throw new Error("Your browser did not provide the selected folder structure.");
      const root = paths[0].split("/")[0];
      setSelected(validateSelection(root, files.map((file, i) => ({ file, path: paths[i] }))));
      setError(""); setStatus("Folder selected. Review the file count, then create your archive.");
      clearDownloads();
    } catch (e) { setError(errText(e)); }
  };
  const createLocal = async () => {
    if (!selected || busy) return;
    setBusy(true); setError(""); setStatus("Reading selected local files...");
    clearDownloads();
    const generated: ArchiveDownload[] = [];
    try {
      const entries: ArchiveEntry[] = [];
      for (let i = 0; i < selected.files.length; i++) {
        const f = selected.files[i];
        setStatus("Reading local files: " + (i + 1) + " / " + selected.files.length);
        const bytes = new Uint8Array(await f.file.arrayBuffer());
        if (bytes.byteLength !== f.file.size) throw new Error("File changed while reading: " + f.path);
        entries.push({ path: f.path, bytes, lastModified: f.file.lastModified });
      }
      const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
      const safeRoot = selected.root.replace(/[^A-Za-z0-9._-]/g, "_");
      const formats: ("zip" | "tgz")[] = mode === "both" ? ["zip", "tgz"] : [mode];
      for (const format of formats) {
        setStatus("Building " + format.toUpperCase() + " locally... No files are uploaded.");
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const bytes = buildLocalArchive(entries, format);
        const digest = await sha256(bytes);
        const name = safeRoot + "-" + stamp + "." + format;
        const url = makeUrl(bytes, format === "zip" ? "application/zip" : "application/gzip");
        const checksumUrl = URL.createObjectURL(new Blob([digest + "  " + name + "\n"], { type: "text/plain" }));
        urls.current.push(url, checksumUrl);
        generated.push({ name, url, checksumUrl, size: bytes.byteLength });
      }
      setDownloads(generated);
      setStatus("PASS: " + generated.length + " verified archive format(s) prepared in your browser. Download the archives and SHA-256 sidecars below.");
    } catch (e) {
      clearDownloads();
      setError("HOLD: No complete archive was delivered. " + errText(e));
      setStatus("");
    } finally { setBusy(false); }
  };
  const runServer = async () => {
    if (!canRunServer || busy || !src.trim()) return;
    setBusy(true); setError(""); setServerResult("");
    try {
      const response = await fetch("/api/ops/archive-dir", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ src: src.trim(), outdir: outdir.trim(), mode }),
      });
      const data = await response.json().catch(() => ({ error: "Invalid server response" }));
      setServerResult(JSON.stringify({ status: response.status, ...data }, null, 2));
    } catch (e) { setServerResult(errText(e)); }
    finally { setBusy(false); }
  };
  const copyCommand = async () => {
    try { await navigator.clipboard.writeText(fallbackCommand(src, outdir, mode)); setStatus("Backup command copied."); }
    catch { setError("Clipboard unavailable. Select and copy the command text manually."); }
  };
  return (
    <div style={{ ...boxStyle, marginTop: 10, marginBottom: 12 }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Archive Folder <span style={{ opacity: 0.6, fontSize: 12 }}>ZIP / TGZ</span></div>
      <div style={subtleText}>Pick an exact folder and build its archive. Local mode runs entirely inside your browser and never sends document contents to the VPS.</div>
      <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
        <label><input type="radio" checked={target === "local"} onChange={() => switchTarget("local")} /> Local Mac — private</label>
        <label><input type="radio" checked={target === "server"} onChange={() => switchTarget("server")} /> Server (VPS)</label>
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {target === "local" ? (
          <>
            <button type="button" style={buttonStyle} disabled={busy} onClick={() => void chooseFolder()}>Choose folder…</button>
            <input ref={fallbackInput} type="file" multiple style={{ display: "none" }}
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={chooseFallback} />
          </>
        ) : null}
        <label style={{ fontWeight: 750 }}>Format{" "}
          <select value={mode} disabled={busy} onChange={(event) => { clearDownloads(); setMode(event.target.value as LocalArchiveMode); }} style={{ ...fieldStyle, width: "auto" }}>
            <option value="zip">ZIP — recommended for documents</option>
            <option value="tgz">TGZ — Unix backup</option>
            <option value="both">Both — ZIP + TGZ</option>
          </select>
        </label>
      </div>
      {target === "local" ? (
        <>
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))" }}>
            {selected ? (
              <>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Selected: {selected.root}/</div>
                <div style={{ ...subtleText, marginTop: 4 }}>{selected.files.length.toLocaleString()} files · {prettyBytes(selected.size)} · includes nested subfolders and original filenames</div>
                <div style={{ ...tinyText, marginTop: 7 }}>Preview: {selected.files.slice(0, 5).map((item) => item.path).join(" · ")}{selected.files.length > 5 ? " · …" : ""}</div>
              </>
            ) : <div style={subtleText}>No folder selected. Choose <b>IES</b> directly—not your entire iCloud Desktop.</div>}
          </div>
          <button type="button" style={{ ...buttonStyle, marginTop: 12, opacity: !selected || busy ? 0.55 : 1 }} disabled={!selected || busy} onClick={() => void createLocal()}>
            {busy ? "Creating archive…" : "Create " + (mode === "both" ? "ZIP + TGZ" : mode.toUpperCase()) + " from selected folder"}
          </button>
          {downloads.length > 0 ? (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))", borderRadius: 10 }}>
              <div style={{ fontWeight: 850, marginBottom: 8 }}>Archive ready — save to your Mac</div>
              {downloads.map((d) => <div key={d.name} style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 7 }}>
                <a href={d.url} download={d.name}>Download {d.name} ({prettyBytes(d.size)})</a>
                <a href={d.checksumUrl} download={d.name + ".sha256"}>Download SHA-256</a>
              </div>)}
              <div style={tinyText}>Chrome normally saves to Downloads unless you have configured it to ask where to save files. Keep the matching .sha256 with each archive.</div>
            </div>
          ) : null}
          <div style={{ ...tinyText, marginTop: 9 }}>For legal records, ZIP preserves selected accessible files without applying the old VPSSentry source-code exclusion list. Files must be fully available from iCloud. Browser selection does not preserve empty folders or full filesystem metadata.</div>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>Advanced · Terminal backup (no browser picker required)</summary>
            <div style={{ ...tinyText, marginTop: 8 }}>Paste the exact folder path only if you need the terminal fallback. Browsers intentionally do not reveal your local absolute path. The command archives only the exact folder and writes a SHA-256 checksum.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, marginTop: 10 }}>
              <label>Exact local source path<input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="/Users/you/…/IES" style={fieldStyle} /></label>
              <label>Output directory<input value={outdir} onChange={(e) => setOutdir(e.target.value)} style={fieldStyle} /></label>
            </div>
            <button type="button" style={{ ...buttonStyle, marginTop: 8 }} onClick={() => void copyCommand()}>Copy terminal command</button>
            <pre style={{ ...tinyText, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 8 }}>{fallbackCommand(src, outdir, mode)}</pre>
          </details>
        </>
      ) : (
        <>
          <div style={{ ...tinyText, marginTop: 12 }}>Server mode archives approved VPS directories only. It never selects local Mac files.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 10, marginTop: 12 }}>
            <label>VPS source folder<input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="/var/www/…" style={fieldStyle} /></label>
            <label>VPS output folder<input value={outdir} onChange={(e) => setOutdir(e.target.value)} style={fieldStyle} /></label>
          </div>
          <button type="button" disabled={!canRunServer || !src.trim() || busy} onClick={() => void runServer()} style={{ ...buttonStyle, marginTop: 10, opacity: !canRunServer || !src.trim() || busy ? 0.5 : 1 }}>
            {busy ? "Running…" : "Run on VPS"}
          </button>
          {!canRunServer ? <div style={tinyText}>An ops role is required for server execution.</div> : null}
          {serverResult ? <pre style={{ ...tinyText, whiteSpace: "pre-wrap", maxHeight: 230, overflow: "auto" }}>{serverResult}</pre> : null}
        </>
      )}
      {status ? <div role="status" style={{ ...tinyText, marginTop: 10 }}>{status}</div> : null}
      {error ? <div role="alert" style={{ marginTop: 10, color: "#ef7777", fontWeight: 700 }}>{error}</div> : null}
    </div>
  );
}

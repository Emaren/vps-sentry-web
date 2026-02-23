"use client";

import React from "react";
import { boxStyle, subtleText, tinyText } from "@/app/dashboard/_styles";
import { hasRequiredRole, type AppRole } from "@/lib/rbac-policy";

type Mode = "zip" | "tgz" | "both";
type Target = "local" | "server";

const localDefaultOutdir = "~/projects/VPSSentry/context";
const serverDefaultOutdir = "/var/www/VPSSentry/context";
const localDefaultSourceParent = "~/projects";
const localDefaultOutdirParent = "~/projects/VPSSentry";

type DirectoryPickerHandle = { name: string };
type DirectoryApiPickResult =
  | { kind: "picked"; name: string }
  | { kind: "cancelled" }
  | { kind: "unavailable" };

function shellQuote(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function shellPathArg(value: string): string {
  if (value === "~") return "\"${HOME}\"";
  if (value.startsWith("~/")) {
    const suffix = value.slice(2).replace(/[\\`"$]/g, "\\$&");
    return "\"${HOME}/" + suffix + "\"";
  }
  return shellQuote(value);
}

function buildLocalCommand(src: string, outdir: string, mode: Mode): string {
  const exe = "~/projects/VPSSentry/bin/archive-dir";
  const srcArg = src.trim() ? shellPathArg(src.trim()) : shellQuote("<PASTE_FOLDER_PATH>");
  const outArg = outdir.trim() ? shellPathArg(outdir.trim()) : shellPathArg(localDefaultOutdir);
  const modeFlag = mode === "zip" ? "--zip-only" : mode === "tgz" ? "--tgz-only" : "--both";
  return `${exe} --src ${srcArg} --outdir ${outArg} ${modeFlag}`;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function applyPickedFolderName(currentPath: string, folderName: string, fallbackParent: string): string {
  const nextName = folderName.trim().replace(/\//g, "");
  if (!nextName) return currentPath;

  const raw = currentPath.trim().replace(/\/+$/g, "");
  if (!raw) return `${fallbackParent}/${nextName}`;
  if (raw === "~") return `~/${nextName}`;

  const slash = raw.lastIndexOf("/");
  if (slash < 0) return `${fallbackParent}/${nextName}`;
  if (slash === 0) return `/${nextName}`;
  return `${raw.slice(0, slash)}/${nextName}`;
}

function folderNameFromFileList(files: FileList | null): string | null {
  if (!files || files.length === 0) return null;
  const first = files.item(0) as (File & { webkitRelativePath?: string }) | null;
  const rel = typeof first?.webkitRelativePath === "string" ? first.webkitRelativePath : "";
  if (!rel) return null;
  const top = rel.split("/")[0]?.trim();
  return top ? top : null;
}

export default function ArchiveFolderCard(props: { userRole: AppRole }) {
  const canRunServer = hasRequiredRole(props.userRole, "ops");

  const [target, setTarget] = React.useState<Target>("local");
  const [src, setSrc] = React.useState("");
  const [outdir, setOutdir] = React.useState(localDefaultOutdir);
  const [manualSource, setManualSource] = React.useState(false);
  const [manualOutdir, setManualOutdir] = React.useState(false);
  const [pickerNote, setPickerNote] = React.useState<string>("");
  const [mode, setMode] = React.useState<Mode>("both");
  const [busy, setBusy] = React.useState(false);
  const [serverResult, setServerResult] = React.useState("");
  const sourcePickerInputRef = React.useRef<HTMLInputElement | null>(null);
  const outdirPickerInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setOutdir(target === "local" ? localDefaultOutdir : serverDefaultOutdir);
    if (target === "server") {
      setManualSource(true);
      setManualOutdir(true);
      setPickerNote("");
      return;
    }
    setManualSource(false);
    setManualOutdir(false);
  }, [target]);

  const command = React.useMemo(() => buildLocalCommand(src, outdir, mode), [src, outdir, mode]);

  const copyCommand = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Clipboard writes can be denied by browser permissions.
    }
  }, [command]);

  const pickDirectoryNameWithApi = React.useCallback(async (): Promise<DirectoryApiPickResult> => {
    if (typeof window === "undefined") return { kind: "unavailable" };
    if (!window.isSecureContext || typeof navigator === "undefined") {
      return { kind: "unavailable" };
    }

    const withPicker = navigator as Navigator & {
      showDirectoryPicker?: () => Promise<DirectoryPickerHandle>;
    };

    if (typeof withPicker.showDirectoryPicker !== "function") {
      return { kind: "unavailable" };
    }

    try {
      const picked = await withPicker.showDirectoryPicker();
      const pickedName = typeof picked?.name === "string" ? picked.name.trim() : "";
      if (!pickedName) return { kind: "cancelled" };
      return { kind: "picked", name: pickedName };
    } catch (error: unknown) {
      const message = errorMessage(error);
      // User-cancel is expected behavior; avoid noisy UI.
      if (/abort|cancel/i.test(message)) return { kind: "cancelled" };
      throw error;
    }
  }, []);

  const handleSourcePickerFallback = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const folderName = folderNameFromFileList(event.target.files);
      if (folderName) {
        setSrc((prev) => applyPickedFolderName(prev, folderName, localDefaultSourceParent));
        setPickerNote("");
      } else {
        setPickerNote("Folder picker did not return a folder. You can type a path manually.");
      }
      event.target.value = "";
    },
    []
  );

  const handleOutdirPickerFallback = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const folderName = folderNameFromFileList(event.target.files);
      if (folderName) {
        setOutdir((prev) => applyPickedFolderName(prev, folderName, localDefaultOutdirParent));
        setPickerNote("");
      } else {
        setPickerNote("Folder picker did not return a folder. You can type a path manually.");
      }
      event.target.value = "";
    },
    []
  );

  const pickLocalSource = React.useCallback(async () => {
    if (target !== "local" || manualSource) return;
    setPickerNote("");
    try {
      const picked = await pickDirectoryNameWithApi();
      if (picked.kind === "picked") {
        setSrc((prev) => applyPickedFolderName(prev, picked.name, localDefaultSourceParent));
        return;
      }
      if (picked.kind === "cancelled") return;

      if (sourcePickerInputRef.current) {
        sourcePickerInputRef.current.click();
      } else {
        setPickerNote("Folder picker unavailable in this browser context. Switch to manual path entry.");
      }
    } catch (error: unknown) {
      setPickerNote(`Folder picker error: ${errorMessage(error)}`);
    }
  }, [manualSource, pickDirectoryNameWithApi, target]);

  const pickLocalOutdir = React.useCallback(async () => {
    if (target !== "local" || manualOutdir) return;
    setPickerNote("");
    try {
      const picked = await pickDirectoryNameWithApi();
      if (picked.kind === "picked") {
        setOutdir((prev) => applyPickedFolderName(prev, picked.name, localDefaultOutdirParent));
        return;
      }
      if (picked.kind === "cancelled") return;

      if (outdirPickerInputRef.current) {
        outdirPickerInputRef.current.click();
      } else {
        setPickerNote("Folder picker unavailable in this browser context. Switch to manual path entry.");
      }
    } catch (error: unknown) {
      setPickerNote(`Folder picker error: ${errorMessage(error)}`);
    }
  }, [manualOutdir, pickDirectoryNameWithApi, target]);

  const runOnServer = React.useCallback(async () => {
    if (!canRunServer || busy || !src.trim()) return;
    setBusy(true);
    setServerResult("");
    try {
      const res = await fetch("/api/ops/archive-dir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          src: src.trim(),
          outdir: outdir.trim(),
          mode,
        }),
      });

      const payload = normalizeRecord(await res.json().catch(() => null));
      setServerResult(JSON.stringify({ status: res.status, ...payload }, null, 2));
    } catch (error: unknown) {
      setServerResult(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [busy, canRunServer, mode, outdir, src]);

  const directoryInputAttrs = {
    webkitdirectory: "",
    directory: "",
  } as React.InputHTMLAttributes<HTMLInputElement>;

  return (
    <div style={{ ...boxStyle, marginTop: 10, marginBottom: 12 }}>
      <input
        {...directoryInputAttrs}
        ref={sourcePickerInputRef}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        style={{ display: "none" }}
        onChange={handleSourcePickerFallback}
      />
      <input
        {...directoryInputAttrs}
        ref={outdirPickerInputRef}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        style={{ display: "none" }}
        onChange={handleOutdirPickerFallback}
      />
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Archive Folder (ZIP / TGZ / Both)</div>
      <div style={subtleText}>
        Local MBP generates a copy/paste command. Server mode runs the same archive script on VPS.
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input
            type="radio"
            checked={target === "local"}
            onChange={() => setTarget("local")}
            style={{ cursor: "pointer" }}
          />
          <span>Local MBP</span>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input
            type="radio"
            checked={target === "server"}
            onChange={() => setTarget("server")}
            style={{ cursor: "pointer" }}
          />
          <span>Server (VPS)</span>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, marginTop: 10 }}>
        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Source folder</div>
          <input
            value={src}
            onChange={(event) => setSrc(event.target.value)}
            onClick={() => {
              if (target === "local" && !manualSource) void pickLocalSource();
            }}
            readOnly={target === "local" && !manualSource}
            placeholder={target === "local" ? "/Users/you/projects/..." : "/var/www/..."}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
              background: "var(--site-input-bg, rgba(255,255,255,0.03))",
              color: "inherit",
              cursor: target === "local" && !manualSource ? "pointer" : "text",
            }}
          />
          {target === "local" ? (
            <button
              type="button"
              onClick={() => setManualSource((v) => !v)}
              style={{
                marginTop: 6,
                border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
                background: "var(--dash-card-bg, rgba(255,255,255,0.03))",
                color: "inherit",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              {manualSource ? "Use picker mode" : "Type path manually"}
            </button>
          ) : null}
          <div style={{ ...tinyText, marginTop: 6 }}>
            Uses your existing context scrub/exclude policy (node_modules, .git, .next, secrets, temp files).
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Output folder</div>
          <input
            value={outdir}
            onChange={(event) => setOutdir(event.target.value)}
            onClick={() => {
              if (target === "local" && !manualOutdir) void pickLocalOutdir();
            }}
            readOnly={target === "local" && !manualOutdir}
            placeholder={target === "local" ? localDefaultOutdir : serverDefaultOutdir}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
              background: "var(--site-input-bg, rgba(255,255,255,0.03))",
              color: "inherit",
              cursor: target === "local" && !manualOutdir ? "pointer" : "text",
            }}
          />
          {target === "local" ? (
            <button
              type="button"
              onClick={() => setManualOutdir((v) => !v)}
              style={{
                marginTop: 6,
                border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
                background: "var(--dash-card-bg, rgba(255,255,255,0.03))",
                color: "inherit",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              {manualOutdir ? "Use picker mode" : "Type path manually"}
            </button>
          ) : null}
          <div style={{ ...tinyText, marginTop: 6 }}>Writes .zip/.tgz plus .sha256 sidecars.</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 800 }}>Mode:</div>
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as Mode)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
            background: "var(--site-input-bg, rgba(255,255,255,0.03))",
            color: "inherit",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          <option value="zip">ZIP</option>
          <option value="tgz">TGZ</option>
          <option value="both">Both</option>
        </select>

        {target === "local" ? (
          <button
            type="button"
            onClick={() => void copyCommand()}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
              background: "var(--dash-btn-bg-strong, rgba(255,255,255,0.06))",
              color: "inherit",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Copy command
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void runOnServer()}
            disabled={!canRunServer || busy || !src.trim()}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
              background: "var(--dash-btn-bg-strong, rgba(255,255,255,0.06))",
              color: "inherit",
              fontWeight: 900,
              opacity: !canRunServer || busy || !src.trim() ? 0.7 : 1,
              cursor: !canRunServer || busy || !src.trim() ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Running..." : "Run on server"}
          </button>
        )}
      </div>

      {target === "local" ? (
        <div style={{ ...tinyText, marginTop: 8 }}>
          Click Source/Output fields to pick folders. Browser security only reveals folder name, so the parent path is preserved.
        </div>
      ) : null}

      {pickerNote ? <div style={{ ...tinyText, marginTop: 6 }}>{pickerNote}</div> : null}

      {target === "local" ? (
        <pre
          style={{
            marginTop: 10,
            marginBottom: 0,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "var(--site-input-bg, rgba(255,255,255,0.03))",
            border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
            borderRadius: 10,
            padding: 10,
          }}
        >
          {command}
        </pre>
      ) : null}

      {target === "server" && !canRunServer ? (
        <div style={{ ...tinyText, marginTop: 8 }}>Needs ops role for server execution.</div>
      ) : null}

      {serverResult ? (
        <pre
          style={{
            marginTop: 10,
            marginBottom: 0,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "var(--site-input-bg, rgba(255,255,255,0.03))",
            border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
            borderRadius: 10,
            padding: 10,
            maxHeight: 260,
            overflow: "auto",
          }}
        >
          {serverResult}
        </pre>
      ) : null}
    </div>
  );
}

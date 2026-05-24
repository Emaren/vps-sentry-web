"use client";

import React from "react";
import { boxStyle, subtleText, tinyText } from "@/app/dashboard/_styles";
import { hasRequiredRole, type AppRole } from "@/lib/rbac-policy";

type Mode = "zip" | "tgz" | "both";
type Target = "local" | "server";

const localDefaultOutdir = "~/projects/VPSSentry/context";
const serverDefaultOutdir = "/var/www/VPSSentry/context";

const localSourceExamples = [
  {
    label: "DE watcher",
    path: "~/projects/AoE2DEWarWagers/aoe2de-watcher",
  },
  {
    label: "DE project",
    path: "~/projects/AoE2DEWarWagers",
  },
  {
    label: "AoE2War watcher",
    path: "~/projects/AoE2HDBets/aoe2-watcher",
  },
];

const localOutdirExamples = [
  {
    label: "VPSSentry context",
    path: localDefaultOutdir,
  },
];

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

const smallHelperButtonStyle: React.CSSProperties = {
  border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
  background: "var(--dash-card-bg, rgba(255,255,255,0.03))",
  color: "inherit",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  padding: "4px 8px",
  cursor: "pointer",
};

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ArchiveFolderCard(props: { userRole: AppRole }) {
  const canRunServer = hasRequiredRole(props.userRole, "ops");

  const [target, setTarget] = React.useState<Target>("local");
  const [src, setSrc] = React.useState("");
  const [outdir, setOutdir] = React.useState(localDefaultOutdir);
  const [clipboardNote, setClipboardNote] = React.useState<string>("");
  const [mode, setMode] = React.useState<Mode>("both");
  const [busy, setBusy] = React.useState(false);
  const [serverResult, setServerResult] = React.useState("");

  React.useEffect(() => {
    setOutdir(target === "local" ? localDefaultOutdir : serverDefaultOutdir);
    setClipboardNote("");
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

  const pasteClipboard = React.useCallback(async (field: "src" | "outdir") => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      setClipboardNote("Clipboard read is unavailable here. Type or paste the path into the text field.");
      return;
    }
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setClipboardNote("Clipboard is empty.");
        return;
      }
      if (field === "src") setSrc(text);
      else setOutdir(text);
      setClipboardNote("Pasted clipboard text. Local paths are validated only when the terminal command runs.");
    } catch {
      setClipboardNote("Clipboard read was blocked by the browser. Type or paste the path into the text field.");
    }
  }, []);

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

  return (
    <div style={{ ...boxStyle, marginTop: 10, marginBottom: 12 }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Archive Folder (ZIP / TGZ / Both)</div>
      <div style={subtleText}>
        Local MBP is a command builder only. It never uploads folder contents to this site.
        Server mode runs the same archive script on VPS paths.
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
            placeholder={target === "local" ? "/Users/you/projects/..." : "/var/www/..."}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
              background: "var(--site-input-bg, rgba(255,255,255,0.03))",
              color: "inherit",
              cursor: "text",
            }}
          />
          {target === "local" ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <button type="button" onClick={() => void pasteClipboard("src")} style={smallHelperButtonStyle}>
                Paste path
              </button>
              {localSourceExamples.map((example) => (
                <button key={example.label} type="button" onClick={() => setSrc(example.path)} style={smallHelperButtonStyle}>
                  {example.label}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ ...tinyText, marginTop: 6 }}>
            {target === "local"
              ? "The browser does not inspect this local path. The copied terminal command validates it honestly."
              : "Server mode validates the VPS path before it runs."}
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Output folder</div>
          <input
            value={outdir}
            onChange={(event) => setOutdir(event.target.value)}
            placeholder={target === "local" ? localDefaultOutdir : serverDefaultOutdir}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
              background: "var(--site-input-bg, rgba(255,255,255,0.03))",
              color: "inherit",
              cursor: "text",
            }}
          />
          {target === "local" ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <button type="button" onClick={() => void pasteClipboard("outdir")} style={smallHelperButtonStyle}>
                Paste path
              </button>
              {localOutdirExamples.map((example) => (
                <button key={example.label} type="button" onClick={() => setOutdir(example.path)} style={smallHelperButtonStyle}>
                  {example.label}
                </button>
              ))}
            </div>
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
          Local MBP mode does not upload or enumerate files. Copy the command and run it in your terminal.
        </div>
      ) : null}

      {clipboardNote ? <div style={{ ...tinyText, marginTop: 6 }}>{clipboardNote}</div> : null}

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

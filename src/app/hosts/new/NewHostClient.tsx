"use client";

import React from "react";
import Link from "next/link";

type CreatedHostResponse = {
  ok: true;
  host: {
    id: string;
    name: string;
    slug: string | null;
    enabled: boolean;
    createdAt: string;
  };
  onboarding: {
    ingestEndpoint: string;
    token: string;
    tokenPrefix: string;
    testIngestCommand: string;
    installHookScript: string;
    note?: string;
  };
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function NewHostClient(props: {
  defaultName: string;
  currentHosts: number;
  hostLimit: number;
}) {
  const { defaultName, currentHosts, hostLimit } = props;

  const [name, setName] = React.useState(defaultName);
  const [slug, setSlug] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<CreatedHostResponse | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  const blockedByLimit = currentHosts >= hostLimit;

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 1400);
    } catch {
      setCopied(null);
    }
  }

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/hosts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slug.trim() ? slug.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Create failed (${res.status})`);
        setCreated(null);
        return;
      }
      setCreated(data as CreatedHostResponse);
    } catch (err: unknown) {
      setError(errorMessage(err));
      setCreated(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div
        style={{
          marginTop: 12,
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.03)",
          fontSize: 13,
          opacity: 0.9,
        }}
      >
        Host usage: <b>{currentHosts}</b> / <b>{hostLimit}</b>
      </div>

      <form onSubmit={onCreate} style={{ marginTop: 14, display: "grid", gap: 12, maxWidth: 640 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, opacity: 0.85 }}>Host name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production VPS"
            required
            maxLength={80}
            style={inputStyle()}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, opacity: 0.85 }}>Slug (optional)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="prod-vps"
            maxLength={48}
            style={inputStyle()}
          />
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="submit"
            disabled={loading || blockedByLimit}
            style={buttonStyle(loading || blockedByLimit)}
          >
            {loading ? "Creating..." : "Create host + generate token"}
          </button>

          <Link href="/hosts" style={secondaryBtnStyle()}>
            Back to hosts
          </Link>
        </div>

        {blockedByLimit ? (
          <div style={warningBoxStyle()}>
            Host limit reached for your plan. Increase plan host limit in Billing/Admin before adding another host.
          </div>
        ) : null}

        {error ? <div style={errorBoxStyle()}>{error}</div> : null}
      </form>

      {created ? (
        <section style={{ marginTop: 18, display: "grid", gap: 12 }}>
          <div style={successBoxStyle()}>
            Created host <b>{created.host.name}</b> ({created.host.slug ?? created.host.id}). Save this token now.
          </div>

          <div style={tokenBoxStyle()}>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>One-time host token</div>
            <div
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 13,
                wordBreak: "break-all",
              }}
            >
              {created.onboarding.token}
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                style={secondaryBtnStyle()}
                onClick={() => copyText("token", created.onboarding.token)}
              >
                {copied === "token" ? "Copied" : "Copy token"}
              </button>
            </div>
          </div>

          <CommandBlock
            title="Test ingest now (single run)"
            command={created.onboarding.testIngestCommand}
            copied={copied === "test"}
            onCopy={() => copyText("test", created.onboarding.testIngestCommand)}
          />

          <CommandBlock
            title="Install auto-push hook (runs after each vps-sentry scan)"
            command={created.onboarding.installHookScript}
            copied={copied === "hook"}
            onCopy={() => copyText("hook", created.onboarding.installHookScript)}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href={`/hosts/${created.host.id}`} style={secondaryBtnStyle()}>
              Open host details
            </Link>
            <Link href="/hosts" style={secondaryBtnStyle()}>
              View all hosts
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CommandBlock(props: {
  title: string;
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{props.title}</div>
      <pre style={preStyle()}>
        <code>{props.command}</code>
      </pre>
      <div style={{ marginTop: 8 }}>
        <button type="button" style={secondaryBtnStyle()} onClick={props.onCopy}>
          {props.copied ? "Copied" : "Copy command"}
        </button>
      </div>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "11px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.03)",
    color: "inherit",
    fontSize: 14,
  };
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "11px 13px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: disabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.08)",
    color: "inherit",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    textDecoration: "none",
    opacity: disabled ? 0.6 : 1,
  };
}

function secondaryBtnStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.04)",
    color: "inherit",
    fontWeight: 700,
    textDecoration: "none",
    display: "inline-block",
  };
}

function preStyle(): React.CSSProperties {
  return {
    margin: 0,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.03)",
    whiteSpace: "pre-wrap",
    overflowX: "auto",
    lineHeight: 1.45,
    fontSize: 13,
  };
}

function warningBoxStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(245,158,11,0.35)",
    background: "rgba(245,158,11,0.08)",
    color: "#fcd34d",
    fontSize: 13,
  };
}

function successBoxStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(34,197,94,0.35)",
    background: "rgba(34,197,94,0.10)",
    color: "#bbf7d0",
    fontSize: 13,
  };
}

function errorBoxStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(239,68,68,0.35)",
    background: "rgba(239,68,68,0.10)",
    color: "#fecaca",
    fontSize: 13,
  };
}

function tokenBoxStyle(): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.03)",
  };
}

"use client";

import React from "react";
import Link from "next/link";
import NoobTip from "@/app/dashboard/_components/NoobTip";

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
  const remainingSlots = Math.max(0, hostLimit - currentHosts);
  const usagePct = hostLimit > 0 ? (currentHosts / hostLimit) * 100 : 0;

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
      <section style={panelStyle()}>
        <div className="dashboard-card-title-row">
          <div style={{ fontWeight: 800, fontSize: 17 }}>
            <NoobTip text="Create host identity, issue one-time token, validate ingest, then install auto-push hook.">
              Host Onboarding Mission Control
            </NoobTip>
          </div>
        </div>

        <div style={usageGridStyle()}>
          <MiniStat
            label="Current hosts"
            value={String(currentHosts)}
            tone={currentHosts > 0 ? "ok" : "neutral"}
          />
          <MiniStat
            label="Plan host limit"
            value={String(hostLimit)}
            tone={blockedByLimit ? "warn" : "ok"}
          />
          <MiniStat
            label="Remaining slots"
            value={String(remainingSlots)}
            tone={remainingSlots > 0 ? "ok" : "warn"}
          />
          <MiniStat
            label="Capacity used"
            value={`${usagePct.toFixed(0)}%`}
            tone={usagePct >= 100 ? "warn" : "neutral"}
          />
        </div>

        <div className="dashboard-chip-row" style={{ marginTop: 10 }}>
          <span className={blockedByLimit ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
            provisioning {blockedByLimit ? "blocked" : "ready"}
          </span>
          <span className="dashboard-chip">token scope: host ingest</span>
          <span className={remainingSlots <= 1 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
            slots left {remainingSlots}
          </span>
        </div>
      </section>

      <div style={layoutStyle()}>
        <section style={panelStyle()}>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>
              <NoobTip text="This creates a host record and returns a one-time token for that host.">
                Create Host Identity
              </NoobTip>
            </div>
          </div>

          <form onSubmit={onCreate} style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--dash-meta)" }}>Host name</span>
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
              <span style={{ fontSize: 13, color: "var(--dash-meta)" }}>Slug (optional)</span>
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
                Host limit reached for your plan. Increase host limit in{" "}
                <Link href="/billing" style={inlineLinkStyle()}>
                  Billing
                </Link>{" "}
                (or admin plan controls), then retry.
              </div>
            ) : null}

            {error ? <div style={errorBoxStyle()}>{error}</div> : null}
          </form>
        </section>

        <aside style={panelStyle()}>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>
              <NoobTip text="Operator checklist for safe onboarding after host creation.">
                What Happens Next
              </NoobTip>
            </div>
          </div>

          <ol style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--dash-muted)", lineHeight: 1.6 }}>
            <li>Create host + receive one-time token.</li>
            <li>Run test ingest command and confirm host appears as fresh.</li>
            <li>Install auto-push hook so every scan is reported.</li>
            <li>Open host details and review incident/remediation baseline.</li>
          </ol>

          <div className="dashboard-chip-row" style={{ marginTop: 12 }}>
            <span className="dashboard-chip">token shown once</span>
            <span className="dashboard-chip">scoped host auth</span>
            <span className="dashboard-chip">copy-safe commands</span>
          </div>

          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--dash-soft-border, rgba(255,255,255,0.08))",
            }}
          >
            <div className="dashboard-card-title-row">
              <div style={{ fontWeight: 800 }}>
                <NoobTip text="Quick checks before troubleshooting deeper networking issues.">
                  If onboarding fails
                </NoobTip>
              </div>
            </div>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--dash-muted)", lineHeight: 1.5 }}>
              <li>Verify host appears on Hosts page after test ingest.</li>
              <li>Confirm server clock is accurate (large skew can break trust).</li>
              <li>Check local firewall and egress if ingest command times out.</li>
              <li>Use install guide commands to validate service/timer health.</li>
            </ul>
            <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
              Runbook:{" "}
              <Link href="/get-vps-sentry" style={inlineLinkStyle()}>
                open install guide
              </Link>
            </div>
          </div>
        </aside>
      </div>

      {created ? (
        <section style={{ ...panelStyle(), marginTop: 18, display: "grid", gap: 12 }}>
          <div style={successBoxStyle()}>
            Created host <b>{created.host.name}</b> ({created.host.slug ?? created.host.id}). Save
            this token now. Prefix: <b>{created.onboarding.tokenPrefix}</b>
          </div>

          <div style={tokenBoxStyle()}>
            <div className="dashboard-card-title-row">
              <div style={{ fontSize: 12, color: "var(--dash-meta)" }}>
                <NoobTip text="This raw token is only returned once. Store it in a secure password vault immediately.">
                  One-time host token
                </NoobTip>
              </div>
            </div>
            <div
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 13,
                wordBreak: "break-all",
                marginTop: 8,
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
            title="Ingest endpoint"
            command={created.onboarding.ingestEndpoint}
            copied={copied === "endpoint"}
            onCopy={() => copyText("endpoint", created.onboarding.ingestEndpoint)}
          />

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

          {created.onboarding.note ? (
            <div style={{ color: "var(--dash-meta)", fontSize: 12 }}>{created.onboarding.note}</div>
          ) : null}

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

function MiniStat(props: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
}) {
  const toneColor =
    props.tone === "ok"
      ? "var(--dash-sev-ok-text)"
      : props.tone === "warn"
        ? "var(--dash-sev-high-text)"
        : "var(--dash-fg)";

  return (
    <div style={miniStatStyle()}>
      <div style={{ fontSize: 11, color: "var(--dash-meta)" }}>{props.label}</div>
      <div style={{ marginTop: 4, fontWeight: 800, fontSize: 24, color: toneColor }}>
        {props.value}
      </div>
    </div>
  );
}

function layoutStyle(): React.CSSProperties {
  return {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    marginTop: 12,
  };
}

function panelStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
    borderRadius: 12,
    background: "var(--dash-card-bg, rgba(255,255,255,0.03))",
    padding: "12px 14px",
  };
}

function usageGridStyle(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
    marginTop: 10,
  };
}

function miniStatStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--dash-soft-border, rgba(255,255,255,0.10))",
    borderRadius: 10,
    padding: "8px 10px",
    background: "var(--dash-card-bg, rgba(255,255,255,0.02))",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "11px 12px",
    borderRadius: 10,
    border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.16))",
    background: "var(--dash-card-bg, rgba(255,255,255,0.03))",
    color: "inherit",
    fontSize: 14,
  };
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "11px 13px",
    borderRadius: 10,
    border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
    background: disabled
      ? "color-mix(in srgb, var(--dash-btn-bg, rgba(255,255,255,0.06)) 75%, transparent 25%)"
      : "var(--dash-btn-bg-strong, rgba(255,255,255,0.08))",
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
    border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
    background: "var(--dash-btn-bg, rgba(255,255,255,0.04))",
    color: "inherit",
    fontWeight: 700,
    textDecoration: "none",
    display: "inline-block",
  };
}

function inlineLinkStyle(): React.CSSProperties {
  return {
    color: "inherit",
    textDecoration: "underline",
    textUnderlineOffset: 2,
    fontWeight: 700,
  };
}

function preStyle(): React.CSSProperties {
  return {
    margin: 0,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
    background:
      "color-mix(in srgb, var(--dash-card-bg, rgba(255,255,255,0.03)) 88%, transparent 12%)",
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
    border: "1px solid var(--dash-sev-high-border, rgba(245,158,11,0.35))",
    background: "var(--dash-sev-high-bg, rgba(245,158,11,0.08))",
    color: "var(--dash-sev-high-text, #fcd34d)",
    fontSize: 13,
  };
}

function successBoxStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--dash-sev-ok-border, rgba(34,197,94,0.35))",
    background: "var(--dash-sev-ok-bg, rgba(34,197,94,0.10))",
    color: "var(--dash-sev-ok-text, #bbf7d0)",
    fontSize: 13,
  };
}

function errorBoxStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--dash-sev-critical-border, rgba(239,68,68,0.35))",
    background: "var(--dash-sev-critical-bg, rgba(239,68,68,0.10))",
    color: "var(--dash-sev-critical-text, #fecaca)",
    fontSize: 13,
  };
}

function tokenBoxStyle(): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
    background:
      "color-mix(in srgb, var(--dash-card-bg, rgba(255,255,255,0.03)) 90%, transparent 10%)",
  };
}

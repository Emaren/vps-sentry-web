import Link from "next/link";

export const dynamic = "force-dynamic";

export default function GetVpsSentryPage() {
  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>Get VPS Sentry</h1>
      <p style={{ opacity: 0.85, lineHeight: 1.5, marginBottom: 18 }}>
        Install the VPS agent on your server in a few minutes. Copy/paste the commands below.
      </p>

      <Section title="1) Clone the repo">
        <CodeBlock>{`git clone https://github.com/Emaren/vps-sentry.git
cd vps-sentry`}</CodeBlock>
      </Section>

      <Section title="2) Install binaries + systemd timer">
        <CodeBlock>{`chmod +x scripts/install.sh scripts/uninstall.sh
./scripts/install.sh`}</CodeBlock>
      </Section>

      <Section title="3) Run once and accept baseline">
        <CodeBlock>{`sudo vps-sentry --format text
sudo vps-sentry --accept-baseline`}</CodeBlock>
      </Section>

      <Section title="4) Confirm it is running">
        <CodeBlock>{`sudo systemctl status vps-sentry.timer --no-pager -l
sudo systemctl status vps-sentry.service --no-pager -l
sudo systemctl list-timers --all | grep vps-sentry
sudo journalctl -u vps-sentry.service -n 50 --no-pager`}</CodeBlock>
      </Section>

      <Section title="Upgrade later">
        <CodeBlock>{`cd ~/vps-sentry
git pull
./scripts/install.sh`}</CodeBlock>
      </Section>

      <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
        <Link
          href="https://github.com/Emaren/vps-sentry"
          style={btn()}
          target="_blank"
          rel="noreferrer"
        >
          View GitHub repo
        </Link>
        <Link href="/login" style={btn()}>
          Sign in to dashboard
        </Link>
      </div>
    </main>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 14 }}>
      <h2 style={{ fontSize: 18, margin: "0 0 8px 0" }}>{props.title}</h2>
      {props.children}
    </section>
  );
}

function CodeBlock(props: { children: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(255,255,255,0.04)",
        whiteSpace: "pre-wrap",
        overflowX: "auto",
        lineHeight: 1.45,
        fontSize: 13,
      }}
    >
      <code>{props.children}</code>
    </pre>
  );
}

function btn(): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.06)",
    fontWeight: 800,
    textDecoration: "none",
    color: "inherit",
    display: "inline-block",
  };
}

import Link from "next/link";
import Image from "next/image";
import CopyCodeBlock from "./CopyCodeBlock";

export const dynamic = "force-dynamic";

export default function GetVpsSentryPage() {
  return (
    <main className="dashboard-shell dashboard-main" style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <Link href="/" aria-label="VPS Sentry home">
          <Image
            src="/vps-sentry-logo.png"
            alt="VPS Sentry logo"
            width={560}
            height={430}
            priority
            style={{
              width: "100%",
              maxWidth: 420,
              height: "auto",
              borderRadius: 12,
            }}
          />
        </Link>
      </div>

      <h1 style={{ fontSize: 34, marginBottom: 10 }}>Get VPS Sentry</h1>
      <p style={{ opacity: 0.85, lineHeight: 1.5, marginBottom: 18 }}>
        Install the VPS agent on your server in a few minutes. Copy/paste the commands below.
      </p>

      <Section title="1) Clone the repo">
        <CopyCodeBlock
          text={`git clone https://github.com/Emaren/vps-sentry.git
cd vps-sentry`}
        />
      </Section>

      <Section title="2) Install binaries + systemd timer">
        <CopyCodeBlock
          text={`chmod +x scripts/install.sh scripts/uninstall.sh
./scripts/install.sh`}
        />
      </Section>

      <Section title="3) Run once and accept baseline">
        <CopyCodeBlock
          text={`sudo vps-sentry --format text
sudo vps-sentry --accept-baseline`}
        />
      </Section>

      <Section title="4) Confirm it is running">
        <CopyCodeBlock
          text={`sudo systemctl status vps-sentry.timer --no-pager -l
sudo systemctl status vps-sentry.service --no-pager -l
sudo systemctl list-timers --all | grep vps-sentry
sudo journalctl -u vps-sentry.service -n 50 --no-pager`}
        />
      </Section>

      <Section title="Upgrade later">
        <CopyCodeBlock
          text={`cd ~/vps-sentry
git pull
./scripts/install.sh`}
        />
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

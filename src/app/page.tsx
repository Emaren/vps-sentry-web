// /var/www/vps-sentry-web/src/app/page.tsx
import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);

  return (
    <main
      className="dashboard-shell dashboard-shell-force-dark dashboard-shell-no-gradient dashboard-main"
      style={{
        minHeight: "calc(100dvh - 32px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 760,
          margin: "0 auto",
          paddingTop: "clamp(18px, 4.5vw, 56px)",
          paddingBottom: 28,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}>
          <Image
            src="/vps-sentry-logo.png"
            alt="VPS Sentry logo"
            width={560}
            height={430}
            priority
            style={{
              width: "100%",
              maxWidth: 560,
              height: "auto",
              borderRadius: 12,
            }}
          />
        </div>

        <h1
          style={{
            fontSize: "clamp(34px, 4.6vw, 46px)",
            lineHeight: 1.1,
            margin: "0 0 12px",
            letterSpacing: "0.01em",
          }}
        >
          VPS Sentry
        </h1>

        <p style={{ opacity: 0.85, lineHeight: 1.6, maxWidth: 650, margin: "0 0 26px" }}>
          Monitor SSH logins, public ports, and watched system files. Get alerted when anything
          changes.
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          {session ? (
            <Link href="/dashboard" style={btn()}>
              Go to dashboard
            </Link>
          ) : (
            <Link href="/login" style={btn()}>
              Sign in
            </Link>
          )}
        </div>

        <div style={{ opacity: 0.65, fontSize: 12 }}>
          {session ? (
            <>
              Signed in as <b>{session.user?.email ?? session.user?.name ?? "user"}</b>
            </>
          ) : (
            <>Not signed in</>
          )}
        </div>
      </div>
    </main>
  );
}

function btn(): React.CSSProperties {
  return {
    padding: "12px 18px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.06)",
    fontWeight: 800,
    lineHeight: 1,
    textDecoration: "none",
    color: "inherit",
    display: "inline-block",
  };
}

// /var/www/vps-sentry-web/src/app/page.tsx
import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);

  return (
    <main className="dashboard-shell dashboard-main" style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
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
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>VPS Sentry</h1>

      <p style={{ opacity: 0.85, lineHeight: 1.5 }}>
        Monitor SSH logins, public ports, and watched system files. Get alerted when anything changes.
      </p>

      <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        <Link href="/get-vps-sentry" style={btn()}>
          Get VPS Sentry
        </Link>
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

      <div style={{ marginTop: 18, opacity: 0.65, fontSize: 12 }}>
        {session ? (
          <>
            Signed in as <b>{session.user?.email ?? session.user?.name ?? "user"}</b>
          </>
        ) : (
          <>Not signed in</>
        )}
      </div>
    </main>
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

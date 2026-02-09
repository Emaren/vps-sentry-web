// /var/www/vps-sentry-web/src/app/login/page.tsx
import Link from "next/link";
import Image from "next/image";
import { Manrope } from "next/font/google";
import LoginClient from "./login-client";

const errorMap: Record<string, string> = {
  // OAuth
  OAuthSignin: "Google sign-in failed. Please try again.",
  OAuthCallback: "Google sign-in callback failed. Please try again.",
  OAuthCreateAccount: "Could not create your account with Google. Please try again.",
  OAuthAccountNotLinked:
    "That email is already linked to a different sign-in method. Try the method you used originally.",
  // Email (magic link)
  EmailSignin: "Could not send the magic link. Please try again.",
  EmailCreateAccount: "Could not create your account. Please try again.",
  // Generic
  Callback: "Sign-in failed during callback. Please try again.",
  AccessDenied: "Access denied.",
  Configuration:
    "Auth is misconfigured on the server. (Usually missing NEXTAUTH_URL / NEXTAUTH_SECRET / EMAIL_SERVER_*)",
  Verification: "This sign-in link is invalid or expired. Please request a new one.",
  Default: "Sign-in failed. Please try again.",
};

function safeCallbackUrl(input?: string) {
  if (!input) return "/dashboard";
  // Only allow same-origin relative paths to avoid open redirects
  if (input.startsWith("/")) return input;
  return "/dashboard";
}

const heroFont = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const errorCode = params.error;
  const errorMessage = errorCode ? errorMap[errorCode] ?? errorMap.Default : null;

  const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  );

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
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <Link href="/" aria-label="VPS Sentry home">
            <Image
              src="/vps-sentry-logo.png"
              alt="VPS Sentry logo"
              width={560}
              height={430}
              priority
              style={{
                width: "100%",
                maxWidth: 480,
                height: "auto",
                borderRadius: 12,
              }}
            />
          </Link>
        </div>

        <h1
          className={heroFont.className}
          style={{ fontSize: "clamp(34px, 4.6vw, 46px)", lineHeight: 1.1, margin: "0 0 14px" }}
        >
          Sign in
        </h1>
        <p
          className={heroFont.className}
          style={{
            opacity: 0.9,
            lineHeight: 1.5,
            fontSize: "clamp(18px, 1.35vw, 22px)",
            maxWidth: 760,
            margin: "0 auto",
            textWrap: "balance",
          }}
        >
          {googleEnabled
            ? "Use Google or a magic link to access your VPS Sentry dashboard."
            : "Use a magic link to access your VPS Sentry dashboard."}
        </p>

        {errorMessage ? (
          <div
            className={heroFont.className}
            style={{
              marginTop: 18,
              marginBottom: 4,
              padding: "10px 12px",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 10,
              background: "rgba(255, 80, 80, 0.10)",
              color: "rgba(255,255,255,0.92)",
              fontSize: 13,
              lineHeight: 1.4,
              maxWidth: 580,
            }}
          >
            {errorMessage}
            {errorCode ? (
              <span style={{ opacity: 0.7 }}> (code: {errorCode})</span>
            ) : null}
          </div>
        ) : null}

        <LoginClient callbackUrl={callbackUrl} error={errorCode} />

        <div className={heroFont.className} style={{ marginTop: 16, opacity: 0.62, fontSize: 12 }}>
          If email doesn’t arrive, check spam.
        </div>
      </div>
    </main>
  );
}

// /var/www/vps-sentry-web/src/app/login/page.tsx
import Link from "next/link";
import Image from "next/image";
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

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { callbackUrl?: string; error?: string };
}) {
  const callbackUrl = safeCallbackUrl(searchParams?.callbackUrl);
  const errorCode = searchParams?.error;
  const errorMessage = errorCode ? errorMap[errorCode] ?? errorMap.Default : null;

  const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  );

  return (
    <main style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
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

      <h1 style={{ fontSize: 34, marginBottom: 10 }}>Sign in</h1>
      <p style={{ opacity: 0.85, lineHeight: 1.5 }}>
        {googleEnabled
          ? "Use Google or a magic link to access your VPS Sentry dashboard."
          : "Use a magic link to access your VPS Sentry dashboard."}
      </p>

      {errorMessage ? (
        <div
          style={{
            marginTop: 14,
            marginBottom: 10,
            padding: "10px 12px",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 10,
            background: "rgba(255, 80, 80, 0.10)",
            color: "rgba(255,255,255,0.92)",
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {errorMessage}
          {errorCode ? (
            <span style={{ opacity: 0.7 }}> (code: {errorCode})</span>
          ) : null}
        </div>
      ) : null}

      <LoginClient callbackUrl={callbackUrl} error={errorCode} />

      <div style={{ marginTop: 18, opacity: 0.6, fontSize: 12 }}>
        If email doesn’t arrive, check spam.
      </div>
    </main>
  );
}

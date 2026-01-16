"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn } from "next-auth/react";

type Providers = Record<
  string,
  { id: string; name: string; type: "oauth" | "email"; signinUrl: string; callbackUrl: string }
>;

const ERROR_COPY: Record<string, string> = {
  OAuthCallback: "OAuth callback failed. Check Google redirect URLs.",
  google: "Sign-in failed. Try again.",
  OAuthAccountNotLinked:
    "That Google account is not linked to an existing user. (If this is your first login, try email magic link first.)",
  Configuration: "Server auth configuration error.",
};

export default function LoginClient({
  callbackUrl,
  error,
}: {
  callbackUrl?: string;
  error?: string;
}) {
  const [providers, setProviders] = useState<Providers>({});
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");

  const errorText = useMemo(() => {
    if (!error) return null;
    return ERROR_COPY[error] ?? `Sign-in error: ${error}`;
  }, [error]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/providers", { cache: "no-store" });
        const data = (await res.json()) as Providers;
        if (alive) setProviders(data ?? {});
      } catch {
        if (alive) setProviders({});
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const hasGoogle = !!providers?.google;
  const hasEmail = !!providers?.email;

  return (
    <div style={{ marginTop: 18 }}>
      {errorText ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,80,80,0.35)",
            background: "rgba(255,80,80,0.08)",
            marginBottom: 14,
            maxWidth: 520,
          }}
        >
          <b>Sign-in error:</b> {errorText}
          <div style={{ opacity: 0.7, marginTop: 6, fontSize: 12 }}>
            Code: <code>{error}</code>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          disabled={loading || !hasGoogle}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.06)",
            fontWeight: 800,
            color: "inherit",
            cursor: loading || !hasGoogle ? "not-allowed" : "pointer",
            opacity: loading || !hasGoogle ? 0.6 : 1,
          }}
          type="button"
          onClick={() =>
            signIn("google", {
              callbackUrl: callbackUrl || "/dashboard",
            })
          }
        >
          Continue with Google
        </button>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Magic link</div>
        <form
          style={{ display: "grid", gap: 10, maxWidth: 520 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!email) return;
            signIn("email", {
              email,
              callbackUrl: callbackUrl || "/dashboard",
            });
          }}
        >
          <input
            style={{
              padding: "12px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.03)",
              color: "inherit",
              width: "100%",
              maxWidth: 420,
            }}
            type="email"
            placeholder="you@domain.com"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading || !hasEmail}
          />
          <button
            disabled={loading || !hasEmail}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              fontWeight: 800,
              color: "inherit",
              cursor: loading || !hasEmail ? "not-allowed" : "pointer",
              width: "fit-content",
              opacity: loading || !hasEmail ? 0.6 : 1,
            }}
            type="submit"
          >
            Email me a magic link
          </button>
        </form>
      </div>
    </div>
  );
}

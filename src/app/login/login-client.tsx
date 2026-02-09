"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Manrope } from "next/font/google";

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

const heroFont = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

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
  const [magicStatus, setMagicStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [magicError, setMagicError] = useState<string | null>(null);
  const resetMagicStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (resetMagicStatusTimer.current) clearTimeout(resetMagicStatusTimer.current);
    };
  }, []);

  const hasGoogle = !!providers?.google;
  const hasEmail = !!providers?.email;

  const magicButtonText =
    magicStatus === "sending"
      ? "Sending..."
      : magicStatus === "sent"
        ? "Sent"
        : "Email me a magic link";

  return (
    <div style={{ marginTop: 24, display: "grid", gap: 18, justifyItems: "center", width: "100%" }}>
      {errorText ? (
        <div
          className={heroFont.className}
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,80,80,0.35)",
            background: "rgba(255,80,80,0.08)",
            marginBottom: 14,
            maxWidth: 520,
            width: "100%",
            textAlign: "left",
          }}
        >
          <b>Sign-in error:</b> {errorText}
          <div style={{ opacity: 0.7, marginTop: 6, fontSize: 12 }}>
            Code: <code>{error}</code>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <button
          disabled={loading || !hasGoogle}
          className={heroFont.className}
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

      <div style={{ width: "100%", maxWidth: 520 }}>
        <div
          className={heroFont.className}
          style={{ fontWeight: 800, marginBottom: 8, textAlign: "center", fontSize: 22 }}
        >
          Magic link
        </div>
        <form
          style={{
            display: "grid",
            gap: 10,
            maxWidth: 520,
            width: "100%",
            justifyItems: "center",
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!email || magicStatus === "sending" || loading || !hasEmail) return;

            if (resetMagicStatusTimer.current) clearTimeout(resetMagicStatusTimer.current);
            setMagicError(null);
            setMagicStatus("sending");

            try {
              const result = await signIn("email", {
                email,
                callbackUrl: callbackUrl || "/dashboard",
                redirect: false,
              });

              if (result?.error) {
                setMagicStatus("idle");
                setMagicError("Could not send the magic link. Please try again.");
                return;
              }

              setMagicStatus("sent");
              resetMagicStatusTimer.current = setTimeout(() => {
                setMagicStatus("idle");
              }, 1800);
            } catch {
              setMagicStatus("idle");
              setMagicError("Could not send the magic link. Please try again.");
            }
          }}
        >
          <input
            className={heroFont.className}
            style={{
              padding: "12px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.03)",
              color: "inherit",
              width: "100%",
              maxWidth: 520,
            }}
            type="email"
            placeholder="you@domain.com"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading || !hasEmail || magicStatus === "sending"}
          />
          <button
            disabled={loading || !hasEmail || magicStatus === "sending"}
            className={heroFont.className}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border:
                magicStatus === "sent"
                  ? "1px solid rgba(34, 197, 94, 0.65)"
                  : "1px solid rgba(255,255,255,0.15)",
              background:
                magicStatus === "sent" ? "rgba(34, 197, 94, 0.18)" : "rgba(255,255,255,0.06)",
              fontWeight: 800,
              color: "inherit",
              cursor:
                loading || !hasEmail || magicStatus === "sending" ? "not-allowed" : "pointer",
              width: "fit-content",
              opacity: loading || !hasEmail || magicStatus === "sending" ? 0.6 : 1,
              minWidth: 210,
            }}
            type="submit"
          >
            {magicButtonText}
          </button>

          {magicError ? (
            <div
              className={heroFont.className}
              style={{
                marginTop: 4,
                color: "rgba(255, 170, 170, 0.95)",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {magicError}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}

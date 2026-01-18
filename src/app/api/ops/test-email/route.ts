// /var/www/vps-sentry-web/src/app/api/ops/test-email/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import nodemailer from "nodemailer";

function envTrim(key: string): string | null {
  const v = process.env[key]?.trim();
  return v && v.length ? v : null;
}

function requireEnv(key: string): string {
  const v = envTrim(key);
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    const to = session?.user?.email?.trim();
    if (!to) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const host = requireEnv("EMAIL_SERVER_HOST");
    const port = Number(requireEnv("EMAIL_SERVER_PORT"));
    const user = requireEnv("EMAIL_SERVER_USER");
    const pass = requireEnv("EMAIL_SERVER_PASSWORD");
    const from = requireEnv("EMAIL_FROM");

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to,
      subject: "VPS Sentry — Test Email",
      text:
        "✅ This is a test email from VPS Sentry.\n\n" +
        `Time: ${new Date().toLocaleString()}\n` +
        `Host: ${envTrim("HOSTNAME") ?? "unknown"}\n`,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

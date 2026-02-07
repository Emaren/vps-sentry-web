// /var/www/vps-sentry-web/src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://vps-sentry.tokentap.ca"),
  title: "VPS Sentry",
  description:
    "Monitor SSH logins, public ports, and watched system files. Get alerted when anything changes.",
  openGraph: {
    title: "VPS Sentry",
    description:
      "Monitor SSH logins, public ports, and watched system files. Get alerted when anything changes.",
    url: "https://vps-sentry.tokentap.ca",
    siteName: "VPS Sentry",
    type: "website",
    images: [
      {
        url: "/vps-sentry-logo.png",
        width: 1152,
        height: 896,
        alt: "VPS Sentry logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VPS Sentry",
    description:
      "Monitor SSH logins, public ports, and watched system files. Get alerted when anything changes.",
    images: ["/vps-sentry-logo.png"],
  },
};

// ✅ Mobile viewport (prevents Safari from treating pages like ~980px desktop and scaling weird)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "tokentap.ca";
  const plausibleSrc = process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ?? "https://plausible.io/js/script.js";

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Script
          defer
          data-domain={plausibleDomain}
          src={plausibleSrc}
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}

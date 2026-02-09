// /var/www/vps-sentry-web/src/app/layout.tsx
import "@/lib/url-trap-runtime";
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

// Never throw on weird build-worker env/request situations.
function safeMetadataBase(): URL {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "https://vps-sentry.tokentap.ca";

  const s = String(raw ?? "").trim();

  // Guard the exact failure you’re seeing
  if (!s || s === "[object Object]") return new URL("https://vps-sentry.tokentap.ca");

  // Absolute URL?
  try {
    return new URL(s);
  } catch {
    // If missing scheme, try https then http
    try {
      return new URL(`https://${s}`);
    } catch {
      try {
        return new URL(`http://${s}`);
      } catch {
        return new URL("https://vps-sentry.tokentap.ca");
      }
    }
  }
}

export const metadata: Metadata = {
  metadataBase: safeMetadataBase(),
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
  const plausibleSrc =
    process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ??
    "https://plausible.io/js/pa-VDQL7gVqfpbKgwbCot3B8.js";

  return (
    <html lang="en" data-site-theme="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Script id="site-theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem("vps_sentry_site_theme");if(t==="light"||t==="sepia"||t==="dark"){document.documentElement.setAttribute("data-site-theme",t);}else{document.documentElement.setAttribute("data-site-theme","dark");}}catch(e){document.documentElement.setAttribute("data-site-theme","dark");}`}
        </Script>
        <Script id="plausible-init" strategy="beforeInteractive">
          {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)};plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init();`}
        </Script>
        <Script async src={plausibleSrc} strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}

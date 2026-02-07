// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/DashboardFooter.tsx
import React from "react";

export default function DashboardFooter(props: {
  links: {
    discord: string;
    contact: string;
    facebook: string;
    x: string;
    tokentap: string;
    tmail: string;
  };
}) {
  const { links } = props;

  return (
    <footer
      style={{
        marginTop: 18,
        paddingTop: 14,
        borderTop: "1px solid var(--dash-soft-border, rgba(255,255,255,0.08))",
        opacity: 0.85,
        fontSize: 12,
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <FooterLink href={links.discord}>Discord</FooterLink>
        <FooterLink href={links.contact}>Contact</FooterLink>
        <FooterLink href={links.facebook}>Facebook</FooterLink>
        <FooterLink href={links.x}>X</FooterLink>
        <FooterLink href={links.tokentap}>TokenTap.ca</FooterLink>
        <FooterLink href={links.tmail}>TMail</FooterLink>
      </div>

      <div style={{ opacity: 0.65 }}>© {new Date().getFullYear()} VPS Sentry</div>
    </footer>
  );
}

function FooterLink(props: { href: string; children: React.ReactNode }) {
  const isExternal = props.href.startsWith("http");
  return (
    <a
      href={props.href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      style={{
        color: "inherit",
        textDecoration: "none",
        borderBottom: "1px solid var(--dash-btn-border, rgba(255,255,255,0.18))",
        paddingBottom: 2,
      }}
    >
      {props.children}
    </a>
  );
}

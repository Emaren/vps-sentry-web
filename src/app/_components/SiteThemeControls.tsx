"use client";

import React from "react";

type SiteTheme = "dark" | "light" | "sepia";

const STORAGE_KEY = "vps_sentry_site_theme";

function applyTheme(theme: SiteTheme) {
  document.documentElement.setAttribute("data-site-theme", theme);
}

export default function SiteThemeControls() {
  const [theme, setTheme] = React.useState<SiteTheme>("dark");

  React.useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light" || saved === "sepia") {
      setTheme(saved);
      applyTheme(saved);
      return;
    }
    applyTheme("dark");
  }, []);

  function choose(next: SiteTheme) {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <div className="site-theme-dock" role="group" aria-label="Color theme">
      <ThemeDot
        label="Use black theme"
        title="Black"
        active={theme === "dark"}
        swatchClass="site-theme-dot-dark"
        onClick={() => choose("dark")}
      />
      <ThemeDot
        label="Use white theme"
        title="White"
        active={theme === "light"}
        swatchClass="site-theme-dot-light"
        onClick={() => choose("light")}
      />
      <ThemeDot
        label="Use sepia theme"
        title="Sepia"
        active={theme === "sepia"}
        swatchClass="site-theme-dot-sepia"
        onClick={() => choose("sepia")}
      />
    </div>
  );
}

function ThemeDot(props: {
  label: string;
  title: string;
  active: boolean;
  swatchClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`site-theme-dot ${props.swatchClass}`}
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.title}
      onClick={props.onClick}
    />
  );
}

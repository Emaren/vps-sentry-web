"use client";

import React from "react";

type DashboardTheme = "dark" | "light" | "sepia";

const STORAGE_KEY = "vps_sentry_dashboard_theme";

export default function DashboardThemeControls(props: { rootId: string }) {
  const { rootId } = props;
  const [theme, setTheme] = React.useState<DashboardTheme>("dark");

  React.useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light" || saved === "sepia") {
      setTheme(saved);
    }
  }, []);

  React.useEffect(() => {
    const root = document.getElementById(rootId);
    if (root) root.dataset.dashboardTheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [rootId, theme]);

  return (
    <div className="dashboard-theme-picker" role="group" aria-label="Dashboard theme">
      <ThemeDot
        label="Black theme"
        title="Black"
        active={theme === "dark"}
        swatchClass="dashboard-theme-dot-dark"
        onClick={() => setTheme("dark")}
      />
      <ThemeDot
        label="White theme"
        title="White"
        active={theme === "light"}
        swatchClass="dashboard-theme-dot-light"
        onClick={() => setTheme("light")}
      />
      <ThemeDot
        label="Sepia theme"
        title="Sepia"
        active={theme === "sepia"}
        swatchClass="dashboard-theme-dot-sepia"
        onClick={() => setTheme("sepia")}
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
  const { label, title, active, swatchClass, onClick } = props;

  return (
    <button
      type="button"
      className={`dashboard-theme-dot ${swatchClass}`}
      aria-label={label}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    />
  );
}

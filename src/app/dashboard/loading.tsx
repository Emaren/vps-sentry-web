import Box from "./_components/Box";

export default function DashboardLoading() {
  return (
    <main className="dashboard-shell dashboard-main">
      <h1 style={{ fontSize: 28, margin: 0 }}>Dashboard</h1>
      <div style={{ marginTop: 8, color: "var(--dash-meta)" }}>
        Loading dashboard panels from live backend sources.
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <Box>Loading status + KPIs...</Box>
        <Box>Loading mission control panels...</Box>
        <Box>Loading alerts, breaches, shipping, and remediation feeds...</Box>
      </div>
    </main>
  );
}

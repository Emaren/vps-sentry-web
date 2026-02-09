import Box from "@/app/dashboard/_components/Box";

export default function HostsLoading() {
  return (
    <main className="dashboard-shell dashboard-main">
      <h1 style={{ fontSize: 28, margin: 0 }}>Hosts</h1>
      <div style={{ marginTop: 8, color: "var(--dash-meta)" }}>
        Loading host inventory and mission-control summaries.
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <Box>Loading host cards...</Box>
        <Box>Loading fleet policy and queue indicators...</Box>
      </div>
    </main>
  );
}

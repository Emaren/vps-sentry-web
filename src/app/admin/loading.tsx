import Box from "@/app/dashboard/_components/Box";

export default function AdminLoading() {
  return (
    <main className="dashboard-shell dashboard-main">
      <h1 style={{ fontSize: 28, margin: 0 }}>Admin</h1>
      <div style={{ marginTop: 8, color: "var(--dash-meta)" }}>
        Loading admin panels and operator runtime telemetry.
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <Box>Loading user and billing linkage table...</Box>
        <Box>Loading queue/incident/SLO/observability snapshots...</Box>
        <Box>Loading recent operations timeline...</Box>
      </div>
    </main>
  );
}

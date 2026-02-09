import Box from "@/app/dashboard/_components/Box";

export default function HostDetailLoading() {
  return (
    <main className="dashboard-shell dashboard-main">
      <h1 style={{ fontSize: 28, margin: 0 }}>Host detail</h1>
      <div style={{ marginTop: 8, color: "var(--dash-meta)" }}>
        Loading host summary, incident timeline, and remediation history.
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <Box>Loading host mission control...</Box>
        <Box>Loading incident workflow + remediation runtime...</Box>
        <Box>Loading snapshot/breach/key ledgers...</Box>
      </div>
    </main>
  );
}

"use client";

export default function AdminError(props: { error: Error; reset: () => void }) {
  return (
    <main className="dashboard-shell dashboard-main">
      <h1 style={{ fontSize: 28, margin: 0 }}>Admin unavailable</h1>
      <div style={{ marginTop: 8, color: "var(--dash-meta)" }}>
        Failed to load admin route: {props.error.message}
      </div>
      <button
        type="button"
        onClick={props.reset}
        className="app-header-btn"
        style={{ marginTop: 12, cursor: "pointer" }}
      >
        Retry admin load
      </button>
    </main>
  );
}

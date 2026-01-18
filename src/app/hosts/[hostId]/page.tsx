export const dynamic = "force-dynamic";

export default function HostDetailPage(props: { params: { hostId: string } }) {
  const hostId = props.params.hostId;

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>Host: {hostId}</h1>
      <p style={{ opacity: 0.75, marginTop: 10 }}>
        Coming soon. This page will show the host’s latest status + history + breaches.
      </p>
    </main>
  );
}

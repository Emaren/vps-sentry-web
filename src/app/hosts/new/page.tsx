import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import NewHostClient from "./NewHostClient";

export const dynamic = "force-dynamic";

export default async function NewHostPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      hostLimit: true,
      hosts: {
        select: { id: true },
      },
    },
  });

  if (!user) redirect("/login");

  const currentHosts = user.hosts.length;
  const hostLimit = user.hostLimit ?? 1;

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>Add Host</h1>
      <p style={{ opacity: 0.8, marginTop: 10, lineHeight: 1.5 }}>
        Create a host, get a one-time API token, and install the auto-push hook so your VPS snapshots
        flow into this dashboard.
      </p>

      <NewHostClient
        defaultName={`vps-${currentHosts + 1}`}
        currentHosts={currentHosts}
        hostLimit={hostLimit}
      />
    </main>
  );
}

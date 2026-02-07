import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "notify.test.denied",
      detail: `status=${access.status} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/notify/test",
        status: access.status,
        email: access.email ?? null,
      },
    });
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  await writeAuditLog({
    req,
    userId: access.identity.userId,
    action: "notify.test.invoked",
    detail: `Notify test invoked by ${access.identity.email}`,
    meta: {
      route: "/api/notify/test",
    },
  });

  return NextResponse.json({ ok: true, note: "stub notify test" });
}

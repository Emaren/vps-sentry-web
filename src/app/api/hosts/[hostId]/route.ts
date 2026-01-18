import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const { hostId } = await ctx.params;
  return NextResponse.json({ ok: true, hostId, host: null, note: "stub" });
}

export async function PUT() {
  return NextResponse.json(
    { ok: false, error: "Not implemented yet" },
    { status: 501 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { ok: false, error: "Not implemented yet" },
    { status: 501 }
  );
}

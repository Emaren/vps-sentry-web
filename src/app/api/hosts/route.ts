import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, hosts: [], note: "stub" });
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Not implemented yet" },
    { status: 501 }
  );
}

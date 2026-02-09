// src/app/api/auth/[...nextauth]/route.ts
// Force Node runtime (Email provider + Prisma adapter are not Edge-safe)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

async function handler(req: Request, ctx: unknown) {
  if (IS_BUILD_TIME) {
    return new Response(JSON.stringify({ ok: true, skipped: "build" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const [{ default: NextAuth }, { authOptions }] = await Promise.all([
    import("next-auth"),
    import("@/lib/auth"),
  ]);
  const authHandler = NextAuth(authOptions);
  return authHandler(req, ctx as never);
}

export { handler as GET, handler as POST };

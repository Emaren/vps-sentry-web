// src/app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// Force Node runtime (Email provider + Prisma adapter are not Edge-safe)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

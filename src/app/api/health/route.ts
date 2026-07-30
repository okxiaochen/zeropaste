import { NextResponse } from "next/server";

import { getDb, getProvider } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — container healthcheck and deployment verification.
 *
 * Reports the provider and whether the database answers. It deliberately does not report a paste
 * count or any timestamps: this endpoint is reachable from wherever the container is, and even
 * aggregate activity data is more than an unauthenticated caller needs.
 */
export async function GET(): Promise<NextResponse> {
  const provider = getProvider();

  try {
    const db = await getDb();
    await db.$queryRawUnsafe("SELECT 1");
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        provider,
        database: "unreachable",
        message: error instanceof Error ? error.message : "unknown error",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: "ok", provider, database: "reachable" });
}

import { NextResponse } from "next/server";

import { getStore } from "@/lib/store/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — container healthcheck and deployment verification.
 *
 * Reports which backend resolved and whether it answers. It deliberately reports no paste count and no
 * timestamps: this endpoint is reachable from wherever the app is, and even aggregate activity is more
 * than an unauthenticated caller needs.
 *
 * Liveness is probed with a read of an id that cannot exist. That exercises the real code path without
 * writing anything, which matters on R2 where a write would cost an operation on every healthcheck.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const store = await getStore();

    // A valid-shaped id ("f" is the 3-month class) that no CSPRNG will ever produce.
    await store.get("f" + "A".repeat(22));

    return NextResponse.json({ status: "ok", backend: store.kind, storage: "reachable" });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        storage: "unreachable",
        message: error instanceof Error ? error.message : "unknown error",
      },
      { status: 503 },
    );
  }
}

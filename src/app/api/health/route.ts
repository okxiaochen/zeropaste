import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SPIKE ONLY — the real implementation checks the database, which does not exist on this branch.
 * See docs/CLOUDFLARE-SPIKE.md. The original is on `main`.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok", provider: "spike-memory", database: "stubbed" });
}

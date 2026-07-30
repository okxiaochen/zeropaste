import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { purgeExpired } from "@/server/pastes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/purge — external trigger for the expiry purge.
 *
 * The default deployment does not need this: the same purge runs on a timer inside the app process
 * (see src/instrumentation.ts). It exists for operators who set PURGE_IN_PROCESS=false and drive
 * deletion from a host crontab, systemd timer, or Kubernetes CronJob.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv();

  if (!env.CRON_SECRET) {
    // Failing closed matters here: an unauthenticated purge endpoint is a denial-of-service tool
    // against a store of short-lived objects.
    return NextResponse.json(
      { error: "CRON_SECRET is not configured, so this endpoint is disabled." },
      { status: 503 },
    );
  }

  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await purgeExpired();
  return NextResponse.json({ status: "ok", deleted: result.deleted });
}

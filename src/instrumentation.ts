/**
 * Next.js runs `register()` once per server process at startup.
 *
 * This is where the expiry purge is scheduled. Running it in-process is what lets the default
 * deployment be a single container with no sidecar and no shared secret.
 */

const globalForPurge = globalThis as unknown as { zeropastePurgeScheduled?: boolean };

export async function register(): Promise<void> {
  // Only the Node.js server can run a timer at all, and only the self-hosted deployment has a process
  // long-lived enough for one to matter. On Cloudflare there is no such process: a Cron Trigger calls
  // the `scheduled` handler in worker.ts instead.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CLOUDFLARE_WORKER === "1") return;

  // Development recompiles call register() again on every change; without this the process would
  // accumulate one timer per reload.
  if (globalForPurge.zeropastePurgeScheduled) return;
  globalForPurge.zeropastePurgeScheduled = true;

  const { getEnv } = await import("./lib/env");
  const env = getEnv();

  console.log(`zeropaste: filesystem store at ${env.STORAGE_DIR}`);

  if (!env.PURGE_IN_PROCESS) {
    console.log(
      "zeropaste: in-process purge disabled (PURGE_IN_PROCESS=false); " +
        "expired pastes will only be removed on read unless an external scheduler calls " +
        "POST /api/cron/purge",
    );
    return;
  }

  const { purgeExpired } = await import("./server/pastes");

  const runPurge = async (): Promise<void> => {
    try {
      const { deleted } = await purgeExpired();
      if (deleted > 0) {
        console.log(`zeropaste: purge deleted ${deleted} expired paste(s)`);
      }
    } catch (error) {
      // A failed purge must never take the server down; the next tick will retry, and expired
      // pastes remain unreadable in the meantime because reads delete them lazily.
      console.error("zeropaste: purge failed", error);
    }
  };

  const intervalMs = env.PURGE_INTERVAL_MINUTES * 60_000;
  console.log(`zeropaste: purge scheduled every ${env.PURGE_INTERVAL_MINUTES} minute(s)`);

  // Clear anything already expired while the server was down, then settle into the interval.
  void runPurge();

  const timer = setInterval(() => void runPurge(), intervalMs);
  // Do not hold the event loop open on this timer alone; the HTTP server keeps the process alive.
  timer.unref?.();
}

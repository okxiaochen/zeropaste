/**
 * Manual purge, for operators who want to force a cleanup without waiting for the timer.
 *
 *   docker compose exec app node node_modules/tsx/dist/cli.mjs scripts/purge.ts
 *
 * or, in development:
 *
 *   pnpm purge
 */
import { purgeExpired } from "../src/server/pastes";

async function main(): Promise<void> {
  const { deleted } = await purgeExpired();
  console.log(`Deleted ${deleted} expired paste(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });

import { getEnv } from "./env";

// Type-only import: erased at compile time, so this file has no runtime dependency on the SQLite
// client existing. The two generated clients are structurally identical (both schemas declare the
// same single model), so one set of types describes both.
import type { PrismaClient } from "@/generated/prisma/sqlite";

export type Db = PrismaClient;

/**
 * Builds the Prisma client for the provider named in DATABASE_PROVIDER.
 *
 * Each branch uses a literal import specifier so bundlers can resolve both statically while only
 * the taken branch is evaluated at runtime. Both clients are generated during the Docker build.
 */
async function createClient(): Promise<Db> {
  const env = getEnv();
  const log: ("warn" | "error")[] = ["warn", "error"];

  if (env.DATABASE_PROVIDER === "postgresql") {
    const { PrismaClient: PostgresClient } = await import("@/generated/prisma/postgres");
    return new PostgresClient({ log }) as unknown as Db;
  }

  const { PrismaClient: SqliteClient } = await import("@/generated/prisma/sqlite");
  const client = new SqliteClient({ log }) as unknown as Db;

  // These cannot be expressed in a Prisma connection URL and must be issued per connection.
  // Without WAL, concurrent reads and writes fail outright with SQLITE_BUSY.
  //
  // $queryRawUnsafe, not $executeRawUnsafe: assignment forms of PRAGMA echo the resulting value as a
  // row, and Prisma rejects a statement that returns rows from $executeRawUnsafe with
  // "Execute returned results, which is not allowed in SQLite".
  await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
  // NORMAL is durable under application crashes, only losing data on OS/power failure. For
  // short-lived pastes that trade-off is worth the substantial write throughput gain.
  await client.$queryRawUnsafe("PRAGMA synchronous = NORMAL");

  return client;
}

// Next.js reloads modules on every edit in development; without this the process would accumulate
// one connection pool per reload until the database refuses new connections.
const globalForDb = globalThis as unknown as { zeropasteDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.zeropasteDb) {
    globalForDb.zeropasteDb = createClient();
  }
  return globalForDb.zeropasteDb;
}

export function getProvider(): "sqlite" | "postgresql" {
  return getEnv().DATABASE_PROVIDER;
}

/**
 * Reclaims disk pages left behind by deleted rows.
 *
 * This matters more than it looks: SQLite does not return freed pages to the filesystem on DELETE,
 * so ciphertext from an expired paste can remain readable in the database file long after the row
 * is gone. Running VACUUM is what makes "the data is removed from the database" literally true.
 */
export async function vacuum(): Promise<void> {
  const db = await getDb();
  if (getProvider() === "sqlite") {
    await db.$executeRawUnsafe("VACUUM");
    return;
  }
  // Postgres autovacuum would get there eventually; being explicit keeps behaviour identical
  // across providers. Cannot run inside a transaction, hence $executeRawUnsafe directly.
  await db.$executeRawUnsafe('VACUUM (ANALYZE) "Paste"');
}

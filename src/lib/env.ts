import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * This module must only be imported from server code. Values needed by the browser are passed
 * down as props from a server component rather than exposed as NEXT_PUBLIC_ variables, because
 * NEXT_PUBLIC_ values are inlined at build time — a self-hosted operator editing .env and
 * restarting the container would otherwise see no effect.
 */

/** Docker passes unset variables through as empty strings; treat those as absent. */
const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const booleanish = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const envSchema = z.object({
  DATABASE_PROVIDER: z.enum(["sqlite", "postgresql"]),
  DATABASE_URL: z.string().min(1, "DATABASE_URL must not be empty"),

  /** Optional canonical origin, used only for metadata. Share links are built from
   *  window.location.origin so that moving the site does not invalidate them. */
  BASE_URL: optionalString.pipe(z.string().url().optional()),

  /** 0 disables the size check entirely. */
  MAX_PLAINTEXT_BYTES: z.coerce.number().int().nonnegative().default(10_485_760),
  HIGHLIGHT_LIMIT_BYTES: z.coerce.number().int().nonnegative().default(2_097_152),

  PURGE_IN_PROCESS: booleanish,
  PURGE_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(15),
  CRON_SECRET: optionalString.pipe(
    z.string().min(16, "CRON_SECRET must be at least 16 characters").optional(),
  ),

  RATE_LIMIT_CREATE_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_READ_PER_MINUTE: z.coerce.number().int().min(1).default(120),

  ENABLE_HSTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // The runbook (docs/AGENT-DEPLOY.md §8) tells operators to match on this exact prefix, so the
    // wording here is load-bearing.
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${details}`);
  }

  cached = parsed.data;
  return cached;
}

/** Configuration the browser legitimately needs, resolved per request on the server. */
export interface PublicConfig {
  maxPlaintextBytes: number;
  highlightLimitBytes: number;
}

export function getPublicConfig(): PublicConfig {
  const env = getEnv();
  return {
    maxPlaintextBytes: env.MAX_PLAINTEXT_BYTES,
    highlightLimitBytes: env.HIGHLIGHT_LIMIT_BYTES,
  };
}

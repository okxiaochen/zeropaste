import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { checkRateLimit, clientAddress } from "@/lib/ratelimit";
import { createPasteSchema } from "@/lib/validation";
import { createPaste } from "@/server/pastes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pastes — stores one encrypted blob.
 *
 * Everything in the request body is already ciphertext. This handler has no way to inspect content,
 * language, or password, and there is intentionally no field through which the client could send
 * them.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv();

  const rate = checkRateLimit(
    `create:${clientAddress(request.headers)}`,
    env.RATE_LIMIT_CREATE_PER_MINUTE,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many pastes created. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = createPasteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request.",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  // The editor enforces this against plaintext before encrypting; re-check the ciphertext here so a
  // modified client cannot bypass it. Ciphertext is slightly larger than the compressed plaintext,
  // so comparing it against the plaintext limit is a conservative bound.
  if (env.MAX_PLAINTEXT_BYTES > 0 && parsed.data.ciphertext.length > env.MAX_PLAINTEXT_BYTES) {
    return NextResponse.json(
      { error: "This paste is too large.", limitBytes: env.MAX_PLAINTEXT_BYTES },
      { status: 413 },
    );
  }

  const paste = await createPaste(parsed.data);

  return NextResponse.json(
    { id: paste.id, expiresAt: paste.expiresAt.toISOString() },
    { status: 201 },
  );
}

/** There is no listing endpoint, by design. Answer a stray GET explicitly rather than 404-ing. */
export function GET(): NextResponse {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}

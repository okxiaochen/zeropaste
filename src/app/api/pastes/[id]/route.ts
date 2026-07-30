import { NextResponse } from "next/server";

import { bytesToBase64Url } from "@/lib/crypto/encoding";
import { getEnv } from "@/lib/env";
import { isValidPasteId } from "@/lib/ids";
import { checkRateLimit, clientAddress } from "@/lib/ratelimit";
import { readPaste } from "@/server/pastes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The response shape the viewer decrypts. Binary fields are base64url. */
export interface PasteResponse {
  ciphertext: string;
  iv: string;
  salt: string;
  kdf: string;
  expiresAt: string;
}

/**
 * GET /api/pastes/:id — returns the encrypted blob.
 *
 * A missing paste and an expired paste are the same 404: the response must not confirm that an id
 * once existed, since that would turn enumeration into a census of past activity.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const env = getEnv();

  const rate = checkRateLimit(
    `read:${clientAddress(request.headers)}`,
    env.RATE_LIMIT_READ_PER_MINUTE,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { id } = await context.params;

  // Reject malformed ids before touching the database, so a flood of junk requests costs nothing.
  if (!isValidPasteId(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const paste = await readPaste(id);
  if (!paste) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body: PasteResponse = {
    ciphertext: bytesToBase64Url(paste.ciphertext),
    iv: bytesToBase64Url(paste.iv),
    salt: bytesToBase64Url(paste.salt),
    kdf: paste.kdf,
    expiresAt: paste.expiresAt.toISOString(),
  };

  return NextResponse.json(body);
}

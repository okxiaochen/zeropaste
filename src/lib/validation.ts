import { z } from "zod";

import { IV_BYTES, SALT_BYTES } from "./crypto/aes";
import { type Bytes, base64UrlToBytes } from "./crypto/encoding";

/**
 * Wire format for POST /api/pastes.
 *
 * Binary fields travel as base64url strings. Note what is absent: no content, no language, no
 * password, no password flag. The server has no field in which to accidentally receive plaintext.
 */

/** Decodes base64url and asserts an exact byte length. */
function base64UrlBytes(exactLength: number, field: string) {
  return z.string().transform((value, ctx) => {
    let bytes: Bytes;
    try {
      bytes = base64UrlToBytes(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} is not valid base64url` });
      return z.NEVER;
    }
    if (bytes.length !== exactLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} must be ${exactLength} bytes, received ${bytes.length}`,
      });
      return z.NEVER;
    }
    return bytes;
  });
}

function base64UrlBlob(field: string) {
  return z.string().min(1).transform((value, ctx) => {
    try {
      return base64UrlToBytes(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} is not valid base64url` });
      return z.NEVER;
    }
  });
}

export const createPasteSchema = z.object({
  ciphertext: base64UrlBlob("ciphertext"),
  iv: base64UrlBytes(IV_BYTES, "iv"),
  salt: base64UrlBytes(SALT_BYTES, "salt"),
  /** Serialised KDF parameters, validated for shape on the client that will consume them. */
  kdf: z.string().min(2).max(256),
  /**
   * Requested lifetime. Not bounded to MAX_TTL_MS here on purpose — resolveExpiresAt() clamps it,
   * so there is exactly one place in the codebase that enforces the ceiling. The bound below only
   * keeps arithmetic on the value from overflowing a Date.
   */
  ttlMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export type CreatePasteInput = z.infer<typeof createPasteSchema>;

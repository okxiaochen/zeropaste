import { z } from "zod";

import { IV_BYTES, KEY_BYTES, SALT_BYTES, aesGcmDecrypt, aesGcmEncrypt } from "./aes";
import { compress, decompress } from "./compress";
import { utf8Decode, utf8Encode } from "./encoding";
import { DecryptionFailedError, PasswordRequiredError } from "./errors";
import { decodeFragment, encodeFragment } from "./fragment";
import { DEFAULT_KDF_PARAMS, deriveContentKey, parseKdfParams, serializeKdfParams } from "./kdf";
import { randomBytes } from "./webcrypto";

export * from "./errors";
export { isCryptoAvailable } from "./webcrypto";
export { decodeFragment } from "./fragment";
export { IV_BYTES, KEY_BYTES, SALT_BYTES } from "./aes";

/** What the author actually wrote. All of it is encrypted; none of it reaches the server. */
export interface PastePayload {
  content: string;
  /** Language identifier from src/lib/languages.ts. Encrypted, so the server cannot profile it. */
  language: string;
  title?: string | undefined;
}

/**
 * The encrypted envelope, versioned so a future format change can be detected after decryption
 * rather than guessed at.
 */
const envelopeSchema = z.object({
  v: z.literal(1),
  content: z.string(),
  language: z.string().min(1).max(64),
  title: z.string().max(200).optional(),
});

/** Exactly the fields the server stores. */
export interface EncryptedRecord {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
  /** Serialised KdfParams. Always present, even without a password, so its presence leaks nothing. */
  kdf: string;
}

export interface EncryptPasteResult extends EncryptedRecord {
  /** Append to the share URL after '#'. Never send this to the server. */
  fragment: string;
}

export async function encryptPaste(
  payload: PastePayload,
  password?: string,
): Promise<EncryptPasteResult> {
  const hasPassword = password !== undefined && password !== "";

  const seed = randomBytes(KEY_BYTES);
  const salt = randomBytes(SALT_BYTES);
  const params = DEFAULT_KDF_PARAMS;

  const key = await deriveContentKey({
    seed,
    salt,
    password: hasPassword ? password : undefined,
    params,
  });

  const envelope = {
    v: 1 as const,
    content: payload.content,
    language: payload.language,
    ...(payload.title ? { title: payload.title } : {}),
  };

  const plaintext = compress(utf8Encode(JSON.stringify(envelope)));
  const { iv, ciphertext } = await aesGcmEncrypt(key, plaintext);

  return {
    ciphertext,
    iv,
    salt,
    kdf: serializeKdfParams(params),
    fragment: encodeFragment({ seed, passwordRequired: hasPassword }),
  };
}

export async function decryptPaste(
  record: EncryptedRecord,
  rawFragment: string,
  password?: string,
): Promise<PastePayload> {
  const { seed, passwordRequired } = decodeFragment(rawFragment);

  if (passwordRequired && (password === undefined || password === "")) {
    throw new PasswordRequiredError();
  }

  if (record.iv.length !== IV_BYTES || record.salt.length !== SALT_BYTES) {
    throw new DecryptionFailedError();
  }

  const key = await deriveContentKey({
    seed,
    salt: record.salt,
    password: passwordRequired ? password : undefined,
    params: parseKdfParams(record.kdf),
  });

  // Throws DecryptionFailedError on a wrong password or any tampering — AES-GCM checks its
  // authentication tag before returning a single byte of plaintext.
  const compressed = await aesGcmDecrypt(key, record.iv, record.ciphertext);

  // Past this point the ciphertext is authenticated, so malformed contents indicate a version
  // mismatch or a bug rather than an attack. Still fail closed.
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(decompress(compressed)));
  } catch {
    throw new DecryptionFailedError();
  }

  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new DecryptionFailedError();
  }

  return {
    content: envelope.data.content,
    language: envelope.data.language,
    title: envelope.data.title,
  };
}

/** Builds the full share link. The fragment is appended in the browser and never transmitted. */
export function buildShareUrl(origin: string, id: string, fragment: string): string {
  return `${origin.replace(/\/+$/, "")}/p/${id}#${fragment}`;
}

export function isPasswordRequired(rawFragment: string): boolean {
  return decodeFragment(rawFragment).passwordRequired;
}

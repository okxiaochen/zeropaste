import { argon2id } from "hash-wasm";
import { z } from "zod";

import { concatBytes, utf8Encode } from "./encoding";
import { KEY_BYTES } from "./aes";
import { getSubtle } from "./webcrypto";

/**
 * Key derivation.
 *
 * Two inputs are combined: a 32-byte random seed that lives only in the URL fragment, and — when
 * the paste is password protected — an Argon2id hash of the password. Both are folded through HKDF
 * to produce the AES key.
 *
 * The security property that matters: a full database dump contains the salt and these parameters
 * but not the seed, so it cannot be used to recover any content, with or without the password.
 */

export interface KdfParams {
  alg: "argon2id";
  /** Envelope version, bumped if the derivation scheme itself changes. */
  v: 1;
  /** Memory cost in KiB. */
  m: number;
  /** Iterations (time cost). */
  t: number;
  /** Parallelism (lanes). */
  p: number;
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  alg: "argon2id",
  v: 1,
  m: 65_536, // 64 MiB
  t: 3,
  p: 1,
};

/**
 * Parameters arrive from the database, so they are attacker-influenced in the threat model where
 * the server is hostile. The upper bounds stop a malicious record from asking the browser to
 * allocate gigabytes and hang the tab.
 */
const kdfParamsSchema = z.object({
  alg: z.literal("argon2id"),
  v: z.literal(1),
  m: z.number().int().min(8_192).max(262_144), // 8 MiB .. 256 MiB
  t: z.number().int().min(1).max(10),
  p: z.number().int().min(1).max(4),
});

export function serializeKdfParams(params: KdfParams): string {
  return JSON.stringify(params);
}

export function parseKdfParams(serialized: string): KdfParams {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new Error("KDF parameters are not valid JSON");
  }

  const parsed = kdfParamsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Unsupported KDF parameters: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return parsed.data;
}

/** Argon2id over the user's password. Runs as WebAssembly, so the CSP needs 'wasm-unsafe-eval'. */
async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  return argon2id({
    password,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: KEY_BYTES,
    outputType: "binary",
  });
}

const HKDF_INFO = utf8Encode("zeropaste-v1");

/**
 * Produces the AES-256 content key.
 *
 * HKDF runs in both the password and no-password cases, so there is a single code path to reason
 * about and to test.
 */
export async function deriveContentKey(options: {
  seed: Uint8Array;
  salt: Uint8Array;
  password?: string | undefined;
  params: KdfParams;
}): Promise<Uint8Array> {
  const { seed, salt, password, params } = options;

  if (seed.length !== KEY_BYTES) {
    throw new Error(`Seed must be ${KEY_BYTES} bytes, received ${seed.length}`);
  }

  const ikm =
    password === undefined || password === ""
      ? seed
      : concatBytes(seed, await derivePasswordKey(password, salt, params));

  const subtle = getSubtle();
  const baseKey = await subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: HKDF_INFO as BufferSource,
    },
    baseKey,
    KEY_BYTES * 8,
  );

  return new Uint8Array(bits);
}

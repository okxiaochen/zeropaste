import { KEY_BYTES } from "./aes";
import { base64UrlToBytes, bytesToBase64Url } from "./encoding";
import { MalformedLinkError } from "./errors";

/**
 * The URL fragment: the half of the secret that never reaches the server.
 *
 *   #v1.n.<base64url 32-byte seed>   no password
 *   #v1.p.<base64url 32-byte seed>   password required
 *
 * The password marker lives here rather than in a database column on purpose. If the server stored
 * a `hasPassword` boolean it would learn something about every paste; encoded here, it learns
 * nothing, and the viewer still knows to prompt before attempting decryption.
 */

const VERSION = "v1";

export interface ParsedFragment {
  seed: Uint8Array;
  passwordRequired: boolean;
}

export function encodeFragment(fragment: ParsedFragment): string {
  if (fragment.seed.length !== KEY_BYTES) {
    throw new Error(`Seed must be ${KEY_BYTES} bytes, received ${fragment.seed.length}`);
  }
  const flag = fragment.passwordRequired ? "p" : "n";
  return `${VERSION}.${flag}.${bytesToBase64Url(fragment.seed)}`;
}

export function decodeFragment(raw: string): ParsedFragment {
  const value = raw.startsWith("#") ? raw.slice(1) : raw;

  if (value === "") {
    // By far the most common real-world failure: chat clients and email software truncate long
    // URLs at the '#', so the recipient gets a link the server accepts but nobody can decrypt.
    throw new MalformedLinkError("the part after # is missing, so the decryption key is not present");
  }

  const parts = value.split(".");
  if (parts.length !== 3) {
    throw new MalformedLinkError("expected three dot-separated fields after #");
  }

  const [version, flag, encodedSeed] = parts as [string, string, string];

  if (version !== VERSION) {
    throw new MalformedLinkError(`unsupported link version "${version}"`);
  }
  if (flag !== "n" && flag !== "p") {
    throw new MalformedLinkError(`unknown password flag "${flag}"`);
  }

  let seed: Uint8Array;
  try {
    seed = base64UrlToBytes(encodedSeed);
  } catch {
    throw new MalformedLinkError("the key is not valid base64url");
  }

  if (seed.length !== KEY_BYTES) {
    throw new MalformedLinkError(
      `the key is ${seed.length} bytes but should be ${KEY_BYTES} — the link is probably truncated`,
    );
  }

  return { seed, passwordRequired: flag === "p" };
}

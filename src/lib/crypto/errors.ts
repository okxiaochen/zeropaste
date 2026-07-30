/**
 * Typed failures the UI needs to distinguish. Everything user-facing branches on these rather than
 * on message text.
 */

export class CryptoUnavailableError extends Error {
  constructor() {
    super(
      "WebCrypto is unavailable. This page must be served over HTTPS (or from localhost) — " +
        "browsers only expose crypto.subtle in a secure context.",
    );
    this.name = "CryptoUnavailableError";
  }
}

/** The link itself is not a valid ZeroPaste link — wrong shape, bad characters, truncated. */
export class MalformedLinkError extends Error {
  constructor(detail: string) {
    super(`This link is not a valid ZeroPaste link: ${detail}`);
    this.name = "MalformedLinkError";
  }
}

/** The fragment says a password is needed and none was supplied. */
export class PasswordRequiredError extends Error {
  constructor() {
    super("This paste is password protected.");
    this.name = "PasswordRequiredError";
  }
}

/**
 * Authenticated decryption failed. Because AES-GCM verifies its tag before returning any
 * plaintext, this single error covers a wrong password, a corrupted ciphertext, and a tampered
 * one. The server cannot tell them apart either — it never sees the key.
 */
export class DecryptionFailedError extends Error {
  constructor() {
    super("Could not decrypt this paste. The password may be wrong, or the link is incomplete.");
    this.name = "DecryptionFailedError";
  }
}

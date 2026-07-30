"use client";

import { useCallback, useEffect, useState } from "react";

import { HighlightedCode } from "@/components/viewer/HighlightedCode";
import { PasswordPrompt } from "@/components/viewer/PasswordPrompt";
import {
  DecryptionFailedError,
  MalformedLinkError,
  PasswordRequiredError,
  decodeFragment,
  decryptPaste,
} from "@/lib/crypto";
import { base64UrlToBytes } from "@/lib/crypto/encoding";
import { DEFAULT_LANGUAGE_ID } from "@/lib/languages";

/**
 * The viewer.
 *
 * Two properties of this component are deliberate rather than incidental:
 *
 * 1. It fetches and decrypts after mount, as a client component. Nothing is rendered on the server,
 *    so the HTML a crawler or a logging proxy sees is empty. That is a privacy property, not a
 *    performance oversight.
 * 2. The fragment is read from `window.location.hash`, which was never part of the request that
 *    delivered this page and is not part of the fetch below either.
 */

interface FetchedRecord {
  ciphertext: string;
  iv: string;
  salt: string;
  kdf: string;
}

type State =
  | { kind: "loading" }
  | { kind: "password"; record: FetchedRecord; wrong: boolean; verifying: boolean }
  | { kind: "content"; content: string; languageId: string }
  | { kind: "gone" }
  | { kind: "error"; message: string };

export function PasteViewer({
  id,
  highlightLimitBytes,
}: {
  id: string;
  highlightLimitBytes: number;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fragment = window.location.hash;

      let passwordRequired: boolean;
      try {
        passwordRequired = decodeFragment(fragment).passwordRequired;
      } catch (cause) {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            cause instanceof MalformedLinkError
              ? cause.message
              : "This link is not a valid ZeroPaste link.",
        });
        return;
      }

      let record: FetchedRecord;
      try {
        const response = await fetch(`/api/pastes/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (response.status === 404) {
          if (!cancelled) setState({ kind: "gone" });
          return;
        }
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        record = (await response.json()) as FetchedRecord;
      } catch (cause) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: cause instanceof Error ? cause.message : "Could not load this paste.",
          });
        }
        return;
      }

      if (cancelled) return;

      if (passwordRequired) {
        setState({ kind: "password", record, wrong: false, verifying: false });
        return;
      }

      try {
        const payload = await decryptPaste(toRecord(record), fragment);
        if (!cancelled) {
          setState({
            kind: "content",
            content: payload.content,
            languageId: payload.language || DEFAULT_LANGUAGE_ID,
          });
        }
      } catch (cause) {
        if (!cancelled) setState({ kind: "error", message: describeFailure(cause) });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const submitPassword = useCallback(
    async (password: string) => {
      if (state.kind !== "password") return;
      setState({ ...state, verifying: true, wrong: false });

      try {
        const payload = await decryptPaste(toRecord(state.record), window.location.hash, password);
        setState({
          kind: "content",
          content: payload.content,
          languageId: payload.language || DEFAULT_LANGUAGE_ID,
        });
      } catch (cause) {
        if (cause instanceof DecryptionFailedError || cause instanceof PasswordRequiredError) {
          // AES-GCM cannot distinguish a wrong password from a corrupted ciphertext, and neither can
          // the server. Treating it as a wrong password is right almost always and lets the user retry.
          setState({ kind: "password", record: state.record, wrong: true, verifying: false });
          return;
        }
        setState({ kind: "error", message: describeFailure(cause) });
      }
    },
    [state],
  );

  switch (state.kind) {
    case "loading":
      return <CenteredNote>Decrypting…</CenteredNote>;
    case "gone":
      return <CenteredNote>This paste does not exist, or it expired and was deleted.</CenteredNote>;
    case "error":
      return <CenteredNote>{state.message}</CenteredNote>;
    case "password":
      return (
        <PasswordPrompt
          wrong={state.wrong}
          verifying={state.verifying}
          onSubmit={submitPassword}
        />
      );
    case "content":
      return (
        <HighlightedCode
          content={state.content}
          languageId={state.languageId}
          highlightLimitBytes={highlightLimitBytes}
        />
      );
  }
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <p className="max-w-md text-center text-sm text-muted-foreground">{children}</p>
    </main>
  );
}

function toRecord(record: FetchedRecord) {
  return {
    ciphertext: base64UrlToBytes(record.ciphertext),
    iv: base64UrlToBytes(record.iv),
    salt: base64UrlToBytes(record.salt),
    kdf: record.kdf,
  };
}

function describeFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Could not decrypt this paste.";
}

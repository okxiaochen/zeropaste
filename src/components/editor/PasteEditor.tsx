"use client";

import { Loader2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { CodeEditor } from "@/components/editor/CodeEditor";
import { LanguageSelect } from "@/components/editor/LanguageSelect";
import { ShareResult } from "@/components/editor/ShareResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildShareUrl, encryptPaste, isCryptoAvailable } from "@/lib/crypto";
import { bytesToBase64Url } from "@/lib/crypto/encoding";
import type { PublicConfig } from "@/lib/env";
import { DEFAULT_EXPIRY_ID, EXPIRY_OPTIONS, findExpiryOption } from "@/lib/expiry";
import { canFormat, format } from "@/lib/formatters";
import { DEFAULT_LANGUAGE_ID } from "@/lib/languages";

interface CreateResult {
  url: string;
  expiresAt: string;
}

const encoder = new TextEncoder();

export function PasteEditor({ config }: { config: PublicConfig }) {
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE_ID);
  const [expiryId, setExpiryId] = useState(DEFAULT_EXPIRY_ID);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  // Evaluated once on mount. Nothing below can work without it, so the form is not rendered at all.
  const cryptoReady = useMemo(() => isCryptoAvailable(), []);

  const byteLength = encoder.encode(content).length;
  const overLimit = config.maxPlaintextBytes > 0 && byteLength > config.maxPlaintextBytes;
  const formattable = canFormat(language);

  if (!cryptoReady) {
    return <InsecureContextNotice />;
  }

  if (result) {
    return (
      <ShareResult
        url={result.url}
        expiresAt={result.expiresAt}
        onCreateAnother={() => setResult(null)}
      />
    );
  }

  async function handleFormat() {
    setError(null);
    setNotice(null);
    setFormatting(true);
    try {
      setContent(await format(content, language));
    } catch (cause) {
      // The original text is never replaced on failure — a formatter that eats your paste because of
      // one syntax error is worse than no formatter.
      setNotice(cause instanceof Error ? cause.message : "Could not format this text.");
    } finally {
      setFormatting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (content === "") {
      setError("Nothing to share yet.");
      return;
    }
    if (overLimit) {
      setError(
        `This is ${formatBytes(byteLength)}, over the ${formatBytes(config.maxPlaintextBytes)} limit.`,
      );
      return;
    }

    const ttlMs = findExpiryOption(expiryId)?.ttlMs;
    if (ttlMs === undefined) {
      setError("Pick an expiry.");
      return;
    }

    setBusy(true);
    try {
      // Encryption happens here, before any network call. The key leaves this function only as part
      // of the fragment appended to the URL below.
      const encrypted = await encryptPaste({ content, language }, password || undefined);

      const response = await fetch("/api/pastes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ciphertext: bytesToBase64Url(encrypted.ciphertext),
          iv: bytesToBase64Url(encrypted.iv),
          salt: bytesToBase64Url(encrypted.salt),
          kdf: encrypted.kdf,
          ttlMs,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Server returned ${response.status}`);
      }

      const created = (await response.json()) as { id: string; expiresAt: string };

      setResult({
        // window.location.origin rather than a configured base URL, so links are always right for
        // however the user reached this page.
        url: buildShareUrl(window.location.origin, created.id, encrypted.fragment),
        expiresAt: created.expiresAt,
      });
      setContent("");
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">ZeroPaste</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Encrypted in your browser. The server stores ciphertext it cannot read.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <form onSubmit={handleSubmit} className="mt-6">
        <CodeEditor
          value={content}
          onChange={setContent}
          languageId={language}
          placeholder="Paste your text here"
        />

        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{formatBytes(byteLength)}</span>
          {config.maxPlaintextBytes > 0 && (
            <span className={overLimit ? "text-destructive" : undefined}>
              limit {formatBytes(config.maxPlaintextBytes)}
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_1fr_1fr]">
          <div className="grid gap-1.5">
            <Label htmlFor="language">Format</Label>
            <LanguageSelect id="language" value={language} onChange={setLanguage} disabled={busy} />
          </div>

          <div className="grid gap-1.5">
            <Label className="sm:invisible">Reformat</Label>
            <Button
              type="button"
              variant="outline"
              onClick={handleFormat}
              disabled={!formattable || content === "" || formatting || busy}
              title={
                formattable
                  ? "Reformat with the browser formatter"
                  : "No browser formatter exists for this language"
              }
            >
              {formatting ? <Loader2 className="animate-spin" /> : <Wand2 />}
              Format
            </Button>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="expiry">Expires after</Label>
            {/* Base UI's Select can emit null when cleared; the expiry always has a value here. */}
            <Select value={expiryId} onValueChange={(value) => setExpiryId(value ?? expiryId)}>
              <SelectTrigger id="expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="password">Password (optional)</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>

        {notice && <p className="mt-4 text-sm text-muted-foreground">{notice}</p>}
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={busy || content === "" || overLimit} className="mt-6">
          {busy && <Loader2 className="animate-spin" />}
          {busy ? "Encrypting…" : "Create link"}
        </Button>
      </form>
    </main>
  );
}

function InsecureContextNotice() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="text-xl font-semibold">This page needs a secure connection</h1>
      <p className="mt-4 text-muted-foreground">
        ZeroPaste encrypts your text in the browser using the Web Crypto API, which browsers only
        expose over HTTPS or on localhost. This page was loaded over plain HTTP, so encryption is
        unavailable.
      </p>
      <p className="mt-4 text-muted-foreground">
        If you run this server, put it behind HTTPS. See <code>docs/AGENT-DEPLOY.md</code> §5.
      </p>
    </main>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

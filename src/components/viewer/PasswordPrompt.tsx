"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shown when the URL fragment carries the password flag.
 *
 * Note that no request has verified anything at this point, and none will: the server cannot check a
 * password it has never seen. "Wrong password" here means AES-GCM rejected its authentication tag,
 * which happens entirely in the browser.
 */
export function PasswordPrompt({
  wrong,
  verifying,
  onSubmit,
}: {
  wrong: boolean;
  verifying: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(password);
        }}
        className="w-full max-w-sm"
      >
        <Label htmlFor="paste-password" className="text-muted-foreground">
          This paste is password protected.
        </Label>
        <div className="mt-2 flex gap-2">
          <Input
            id="paste-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="current-password"
            aria-invalid={wrong || undefined}
          />
          <Button type="submit" disabled={verifying || password === ""}>
            {verifying && <Loader2 className="animate-spin" />}
            Open
          </Button>
        </div>
        {wrong && <p className="mt-2 text-sm text-destructive">Wrong password.</p>}
        {verifying && (
          // Argon2id with a 64 MiB memory cost takes a noticeable moment on purpose: it is what makes
          // guessing the password expensive for anyone who obtains the link.
          <p className="mt-2 text-xs text-muted-foreground">Deriving key…</p>
        )}
      </form>
    </main>
  );
}

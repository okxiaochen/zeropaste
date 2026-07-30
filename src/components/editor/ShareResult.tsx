"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The share link, shown once.
 *
 * The warning here is not boilerplate. The key lives in the fragment and was never sent to the
 * server, so this really is the only moment the complete link exists anywhere but the user's screen.
 */
export function ShareResult({
  url,
  expiresAt,
  onCreateAnother,
}: {
  url: string;
  expiresAt: string;
  onCreateAnother: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Generated locally. Sending the URL to an external QR service would hand the decryption key to
    // a third party, which would defeat the entire design.
    void import("qrcode").then(async ({ default: QRCode }) => {
      try {
        const dataUrl = await QRCode.toDataURL(url, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220,
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (!cancelled) setQr(dataUrl);
      } catch {
        // A URL too long for a QR code is not worth an error message; the link itself still works.
      }
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">Your link is ready</h1>

      <p className="mt-6 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm">
        <strong>Copy it now.</strong> The decryption key is the part after <code>#</code> and was
        never sent to the server. This link cannot be shown again or recovered.
      </p>

      <div className="mt-4 flex gap-2">
        <Input
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="font-mono text-sm"
          aria-label="Share link"
        />
        <Button type="button" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {qr && (
        <div className="mt-6 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URI, not a remote asset */}
          <img
            src={qr}
            alt="QR code for the share link"
            width={110}
            height={110}
            className="rounded-lg border bg-white p-1"
          />
          <p className="text-sm text-muted-foreground">
            Scan to open on another device. The key is inside the code, so treat it like the link.
          </p>
        </div>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        Expires {new Date(expiresAt).toLocaleString()}, after which it is deleted from the database.
      </p>

      <Button variant="ghost" onClick={onCreateAnother} className="mt-8 -ml-3">
        Create another
      </Button>
    </main>
  );
}

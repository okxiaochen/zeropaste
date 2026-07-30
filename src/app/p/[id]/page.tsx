import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PasteViewer } from "@/components/viewer/PasteViewer";
import { getPublicConfig } from "@/lib/env";
import { isValidPasteId } from "@/lib/ids";

/**
 * Belt and braces alongside the X-Robots-Tag header from next.config.ts. A crawler that ignores the
 * header still sees this — and there is nothing in the server-rendered HTML to index regardless.
 */
export const metadata: Metadata = {
  title: "ZeroPaste",
  robots: { index: false, follow: false, nocache: true },
};

// Read configuration per request rather than at build time, so an operator can change .env and
// restart the container without rebuilding the image.
export const dynamic = "force-dynamic";

export default async function PastePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Reject a malformed id here so the client never bothers fetching.
  if (!isValidPasteId(id)) notFound();

  return <PasteViewer id={id} highlightLimitBytes={getPublicConfig().highlightLimitBytes} />;
}

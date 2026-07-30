import type { Metadata, Viewport } from "next";

import { THEME_INIT_SCRIPT } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "ZeroPaste",
  description:
    "Encrypted pastebin. Content is encrypted in your browser; the server cannot read it.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning because the script below mutates <html> before React hydrates, which
    // React would otherwise report as a mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
         * Applies the stored theme before first paint. It has to run synchronously here rather than in
         * a component: anything that waits for hydration paints a light page and then flips it, which
         * is more jarring than a wrong theme would have been.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

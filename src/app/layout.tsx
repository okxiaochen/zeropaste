import type { Metadata, Viewport } from "next";

import { THEME_INIT_SCRIPT } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "ZeroPaste",
  description:
    "Encrypted pastebin. Content is encrypted in your browser; the server cannot read it.",
  /*
   * Referenced from `public/` rather than using Next.js's `app/icon.svg` convention. That convention
   * serves the icon through a route handler at `/icon.svg?<hash>`, which on Workers costs a worker
   * invocation per request; files in `public/` are served as static assets, which are free and do not
   * count against the request quota. `favicon.ico` is included as well for clients that request it
   * directly regardless of these tags — without it, each such request rendered a 404 through the
   * worker at 285 ms of CPU.
   */
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16" },
    ],
  },
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

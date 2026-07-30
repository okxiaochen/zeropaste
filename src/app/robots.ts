import type { MetadataRoute } from "next";

/**
 * robots.txt.
 *
 * Share links carry 128 bits of entropy and are never linked from anywhere, so a crawler has no
 * path to them in the first place. This is belt and braces for the case where a user posts their own
 * link somewhere public: the X-Robots-Tag header on /p/* is the enforcement, and this is the polite
 * request that well-behaved crawlers honour before even fetching.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/p/", "/api/"],
      },
    ],
  };
}

import type { MetadataRoute } from "next";

// Keeps the admin panel out of search results — the password itself is
// still the real gate (Phase 5), this just avoids the URL/panel's
// existence showing up in a public search index at all.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // robots.txt disallow matching is prefix-based, so "/admin" alone
      // already covers every /admin/* subpath (login, the protected pages,
      // etc.) — no need to list them separately.
      disallow: "/admin",
    },
  };
}

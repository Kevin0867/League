import type { MetadataRoute } from "next";

// Allow public marketing/league pages; keep the app (console/portal/api/auth)
// out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/console", "/portal", "/api", "/login", "/reset", "/forgot", "/setup"],
    },
    sitemap: "https://academy.purepickleball.com/sitemap.xml",
    host: "https://academy.purepickleball.com",
  };
}

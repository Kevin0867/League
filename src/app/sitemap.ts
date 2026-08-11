import type { MetadataRoute } from "next";

const BASE = "https://academy.purepickleball.com";

// Public pages only. Kept as a static list — the app's private routes are not
// indexed (see robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/", "/programs", "/coaches", "/clinics", "/locations",
    "/standings", "/schedule", "/championship", "/acp", "/teams",
    "/register", "/terms", "/privacy", "/season-terms",
  ];
  return paths.map((p) => ({ url: `${BASE}${p}`, changeFrequency: "weekly", priority: p === "/" ? 1 : 0.7 }));
}
